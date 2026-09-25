import { Router } from "express"
import fs from "fs"
import path from "path"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"
import { normalizarTelefono } from "../utils/telefono"
import { detectarPais, numeroCompletoAJid } from "../../bot"
import { buscarUsuarioIPTV } from "../iptvservice"
import { resolverSocketRecordatorio } from "../recordatorios"

// Igual que en bot.ts: URL relativa → Buffer del disco, URL http → { url }
const src = (c: string) =>
  c.startsWith("http")
    ? { url: c }
    : fs.readFileSync(path.resolve(c.startsWith("/") ? c.slice(1) : c))

const router = Router()
console.log("✅ [clientes.ts] router cargado OK")

/* Resuelve qué plantilla corresponde a un teléfono dado.
   Prioridad: plantilla con paisDefault == país del cliente
            → plantilla con paisDefault == país del dispositivo que atiende (fallback)
            → null (mensaje por defecto) */
async function resolverPlantilla(
  usuarioId: number,
  telefono: string,
  paisFallback?: string,
): Promise<number | null> {
  const { pais } = detectarPais(telefono)

  // 1. Plantilla del país del cliente
  const porPaisCliente = await prisma.plantillaRecordatorio.findFirst({
    where: { usuarioId, paisDefault: pais },
    select: { id: true },
  })
  if (porPaisCliente) return porPaisCliente.id

  // 2. Plantilla del país del dispositivo que atiende (para países sin plantilla propia)
  if (paisFallback && paisFallback !== pais) {
    const porPaisDispositivo = await prisma.plantillaRecordatorio.findFirst({
      where: { usuarioId, paisDefault: paisFallback },
      select: { id: true },
    })
    if (porPaisDispositivo) return porPaisDispositivo.id
  }

  return null
}

export { resolverPlantilla }

router.get("/", ...auth, async (req: any, res) => {
  const { buscar, servicioId, pais } = req.query
  const where: any = { usuarioId: req.usuario.id }
  if (servicioId) where.servicioId = Number(servicioId)
  if (pais) where.pais = String(pais)
  if (buscar) {
    const b = String(buscar)
    where.OR = [
      { telefono: { contains: b } },
      { usuario:  { contains: b } },
      { notas:    { contains: b } },
    ]
  }
  res.json(await prisma.cuentaCliente.findMany({ where, orderBy: { expiraEn: { sort: "desc", nulls: "last" } }, include: { servicio: true } }))
})

router.post("/", ...auth, async (req: any, res) => {
  try {
    const { telefono, usuario, contrasena, servicioId, pais, notas, expiraEn, plantillaRecordatorioId } = req.body
    if (!telefono || !usuario)
      return res.status(400).json({ error: "Teléfono y usuario son requeridos" })

    const telNormalizado = normalizarTelefono(telefono)

    // Si el usuario no eligió plantilla manualmente, auto-detectar por país del teléfono
    const plantillaId = plantillaRecordatorioId
      ? Number(plantillaRecordatorioId)
      : await resolverPlantilla(req.usuario.id, telNormalizado)

    res.json(await prisma.cuentaCliente.create({
      data: {
        usuarioId:  req.usuario.id,
        telefono:   telNormalizado,
        usuario:    usuario.trim(),
        contrasena: contrasena?.trim() || null,
        servicioId: servicioId ? Number(servicioId) : null,
        pais:       pais ?? "Bolivia",
        notas:      notas?.trim() || null,
        expiraEn:   expiraEn ? new Date(expiraEn) : null,
        plantillaRecordatorioId: plantillaId,
        recordatorioEnviado: expiraEn ? new Date(expiraEn) < new Date() : false,
      },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error al crear" }) }
})

router.post("/importar", ...auth, async (req: any, res) => {
  const { clientes } = req.body
  if (!Array.isArray(clientes) || clientes.length === 0)
    return res.status(400).json({ error: "Sin datos" })

  const servicios = await prisma.servicio.findMany({ where: { usuarioId: req.usuario.id } })
  const servicioMap = new Map(servicios.map(s => [s.nombre.toLowerCase().trim(), s.id]))

  let creados = 0
  const errores: { fila: number; error: string }[] = []
  const creadosIds: number[] = []

  for (const c of clientes) {
    const fila = c._fila ?? "?"
    if (!c.telefono || !c.usuario || !c.contrasena || !c.servicio) {
      errores.push({ fila, error: "Faltan campos obligatorios (Telefono, Usuario, Contrasena, Servicio)" })
      continue
    }
    const servicioId = servicioMap.get(String(c.servicio).toLowerCase().trim())
    if (!servicioId) {
      errores.push({ fila, error: `Servicio "${c.servicio}" no existe en tu cuenta` })
      continue
    }
    try {
      const telNorm    = normalizarTelefono(String(c.telefono))
      const plantillaId = await resolverPlantilla(req.usuario.id, telNorm)
      const nueva = await prisma.cuentaCliente.create({
        data: {
          usuarioId: req.usuario.id,
          telefono:  telNorm,
          usuario:   String(c.usuario).trim(),
          contrasena: String(c.contrasena).trim(),
          servicioId,
          pais:      c.pais?.trim() || "Bolivia",
          notas:     c.notas?.trim() || null,
          plantillaRecordatorioId: plantillaId,
        },
      })
      creadosIds.push(nueva.id)
      creados++
    } catch (e: any) {
      errores.push({ fila, error: e.code === "P2002" ? "Ya existe" : "Error al crear" })
    }
  }

  // Completar en background los datos del panel (plan, fecha, contraseña) de las cuentas nuevas
  if (creadosIds.length > 0) {
    sincronizarImportados(req.usuario.id, creadosIds).catch(e =>
      console.error("❌ [importar] Error en sync background:", e.message)
    )
  }

  res.json({ creados, errores, sincronizando: creadosIds.length > 0 })
})

async function sincronizarImportados(usuarioId: number, ids: number[]): Promise<void> {
  const pendientes = await prisma.cuentaCliente.findMany({
    where: {
      id:      { in: ids },
      paquete: null,
      servicioId: { not: null },
    },
    select: { id: true, usuario: true },
  })
  if (pendientes.length === 0) return
  console.log(`🔄 [importar] Sync en background: ${pendientes.length} cuenta(s)`)

  for (const cuenta of pendientes) {
    try {
      const datos = await buscarUsuarioIPTV(cuenta.usuario, usuarioId)
      let expiraEn: Date | null = null
      if (datos.expira) {
        const iso = datos.expira.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
        const dmy = datos.expira.match(/(\d{2})\/(\d{2})\/(\d{4})/)
        if (iso) expiraEn = new Date(`${iso[1]}T${iso[2]}:00Z`)
        else if (dmy) expiraEn = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`)
      }
      const yaVencio = expiraEn ? expiraEn < new Date() : false
      await prisma.cuentaCliente.update({
        where: { id: cuenta.id },
        data: {
          contrasena: datos.password   || null,
          paquete:    datos.paquete    || null,
          conexiones: datos.conexiones || null,
          ...(expiraEn ? { expiraEn, recordatorioEnviado: yaVencio } : {}),
        },
      })
      console.log(`✅ [importar] ${cuenta.usuario} — plan: ${datos.paquete} | vence: ${expiraEn?.toISOString() ?? "—"}`)
    } catch (e: any) {
      console.warn(`⚠️  [importar] No se pudo sincronizar ${cuenta.usuario}: ${e.message}`)
    }
  }
  console.log(`✅ [importar] Sync background finalizado`)
}

router.put("/:id", ...auth, async (req: any, res) => {
  const id = Number(req.params.id)
  console.log(`\n${"─".repeat(50)}`)
  console.log(`✏️  [PUT /cuentas-clientes/${id}] body recibido:`, JSON.stringify(req.body, null, 2))
  try {
    const { telefono, usuario, contrasena, servicioId, pais, notas, expiraEn, paquete, plantillaRecordatorioId } = req.body
    const data: any = {
      usuario,
      contrasena: contrasena?.trim() || null,
      pais,
      notas:      notas?.trim()   || null,
      paquete:    paquete?.trim() || null,
      servicioId:              servicioId              ? Number(servicioId)              : null,
      plantillaRecordatorioId: plantillaRecordatorioId ? Number(plantillaRecordatorioId) : null,
    }
    if (telefono) data.telefono = normalizarTelefono(telefono)

    const actual = await prisma.cuentaCliente.findUnique({ where: { id }, select: { expiraEn: true } })
    const nuevaFecha = expiraEn ? new Date(expiraEn) : null
    data.expiraEn = nuevaFecha

    console.log(`✏️  [PUT] expiraEn recibido: "${expiraEn}" → Date: ${nuevaFecha}`)
    console.log(`✏️  [PUT] expiraEn actual en DB: ${actual?.expiraEn}`)

    if (actual?.expiraEn?.getTime() !== nuevaFecha?.getTime()) {
      data.recordatorioEnviado = false
      console.log(`✏️  [PUT] fecha cambió → resetea recordatorioEnviado`)
    }

    console.log(`✏️  [PUT] data final a guardar:`, JSON.stringify(data, null, 2))
    const resultado = await prisma.cuentaCliente.update({
      where: { id },
      data,
      include: { servicio: true },
    })
    console.log(`✅ [PUT] guardado OK — expiraEn en DB: ${resultado.expiraEn}`)
    res.json(resultado)
  } catch (e: any) {
    console.error(`❌ [PUT /cuentas-clientes/${id}] ERROR:`, e?.message)
    console.error(e?.stack?.split("\n").slice(0, 5).join("\n"))
    res.status(500).json({ error: e?.message ?? "Error al actualizar" })
  }
})

router.patch("/:id/recordatorio-auto", ...auth, async (req: any, res) => {
  try {
    const id = Number(req.params.id)
    const cuenta = await prisma.cuentaCliente.findUnique({ where: { id } })
    if (!cuenta || (req.usuario.rol !== "admin" && cuenta.usuarioId !== req.usuario.id))
      return res.status(403).json({ error: "Sin permisos" })
    const actualizada = await prisma.cuentaCliente.update({
      where: { id },
      data: { recordatorioAuto: !cuenta.recordatorioAuto },
      include: { servicio: true },
    })
    console.log(`🔔 [recordatorio-auto] ID ${id} → ${actualizada.recordatorioAuto ? "activado" : "desactivado"}`)
    res.json(actualizada)
  } catch (e: any) {
    res.status(500).json({ error: e?.message })
  }
})

router.delete("/lote", ...auth, async (req: any, res) => {
  const { ids } = req.body
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "Sin IDs" })
  const { count } = await prisma.cuentaCliente.deleteMany({
    where: { id: { in: ids.map(Number) }, usuarioId: req.usuario.id },
  })
  res.json({ ok: true, eliminados: count })
})

router.delete("/:id", ...auth, async (req, res) => {
  await prisma.cuentaCliente.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

router.post("/:id/sincronizar", ...auth, async (req: any, res) => {
  const id = Number(req.params.id)
  console.log(`\n${"─".repeat(50)}`)
  console.log(`🔄 [sincronizar] INICIO — ID: ${id}, usuario: ${req.usuario?.id}`)

  let cuenta: any = null
  try {
    console.log(`🔄 [sincronizar] Buscando cuenta en DB...`)
    cuenta = await prisma.cuentaCliente.findUnique({ where: { id } })
    console.log(`🔄 [sincronizar] Cuenta encontrada:`, cuenta ? `usuario="${cuenta.usuario}"` : "null")

    if (!cuenta || (req.usuario.rol !== "admin" && cuenta.usuarioId !== req.usuario.id)) {
      console.log(`🔄 [sincronizar] Sin permisos`)
      return res.status(403).json({ error: "Sin permisos" })
    }
    if (!cuenta.usuario) {
      console.log(`🔄 [sincronizar] Sin usuario IPTV`)
      return res.status(400).json({ error: "Esta cuenta no tiene usuario IPTV asignado" })
    }

    console.log(`🔄 [sincronizar] Llamando buscarUsuarioIPTV("${cuenta.usuario}")...`)
    const datos = await buscarUsuarioIPTV(cuenta.usuario, req.usuario.id)
    console.log(`🔄 [sincronizar] Datos recibidos:`, JSON.stringify(datos, null, 2))

    let expiraEn: Date | null = null
    if (datos.expira) {
      const isoMatch = datos.expira.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
      const dmyMatch = datos.expira.match(/(\d{2})\/(\d{2})\/(\d{4})/)
      if (isoMatch) expiraEn = new Date(`${isoMatch[1]}T${isoMatch[2]}:00Z`)
      else if (dmyMatch) expiraEn = new Date(`${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}T00:00:00Z`)
      console.log(`🔄 [sincronizar] expira="${datos.expira}" → Date: ${expiraEn}`)
    }

    console.log(`🔄 [sincronizar] Guardando en DB...`)
    const actualizada = await prisma.cuentaCliente.update({
      where: { id: cuenta.id },
      data: {
        contrasena: datos.password || cuenta.contrasena || null,
        paquete:    datos.paquete  || null,
        ...(expiraEn ? { expiraEn, recordatorioEnviado: expiraEn < new Date() ? undefined : false } : {}),
      },
      include: { servicio: true },
    })
    console.log(`✅ [sincronizar] OK — ${cuenta.usuario} | pass: ${datos.password} | plan: ${datos.paquete}`)
    res.json(actualizada)
  } catch (e: any) {
    console.error(`❌ [sincronizar] EXCEPCIÓN:`)
    console.error(`   message: ${e?.message}`)
    console.error(`   stack:   ${e?.stack?.split('\n').slice(0,4).join('\n   ')}`)
    // Error específico: usuario no existe en el panel
    if (e?.message?.includes("No se encontró el usuario")) {
      return res.status(404).json({
        error: "Este usuario no existe en el panel IPTV.",
        noEnPanel: true,
        cuentaId: cuenta?.id,
      })
    }
    res.status(500).json({ error: e?.message ?? "Error al consultar el panel" })
  }
})

router.post("/:id/recordatorio", ...auth, async (req: any, res) => {
  try {
    const cuenta = await prisma.cuentaCliente.findUnique({
      where: { id: Number(req.params.id) },
      include: { servicio: true },
    })
    if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" })

    const plantilla = await prisma.plantillaRecordatorio.findUnique({
      where: { id: Number(req.body.plantillaId) },
    })
    if (!plantilla) return res.status(404).json({ error: "Plantilla no encontrada" })

    // Mismo número configurado en "Envío de recordatorios" que usa el envío automático
    const { sock, error } = await resolverSocketRecordatorio(req.usuario.id, cuenta.telefono)
    if (!sock) return res.status(503).json({ error })

    const jid = numeroCompletoAJid(cuenta.telefono)
    const expiraStr = cuenta.expiraEn
      ? new Date(cuenta.expiraEn).toLocaleDateString("es-BO", { timeZone:"UTC", day:"2-digit", month:"2-digit", year:"numeric" })
      : "—"
    const texto = plantilla.mensaje
      .replace(/\{usuario\}/g,   cuenta.usuario)
      .replace(/\{contrasena\}/g, cuenta.contrasena ?? "")
      .replace(/\{servicio\}/g,  cuenta.servicio?.nombre ?? "")
      .replace(/\{pais\}/g,      cuenta.pais)
      .replace(/\{expira\}/g,    expiraStr)

    const ext = (plantilla.imagenUrl ?? "").split(".").pop()?.toLowerCase() ?? ""

    if (plantilla.tipo === "imagen" && plantilla.imagenUrl) {
      await sock.sendMessage(jid, { image: src(plantilla.imagenUrl), caption: texto })
    } else if (plantilla.tipo === "documento" && plantilla.imagenUrl) {
      const mimeDoc: Record<string, string> = {
        pdf: "application/pdf", doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }
      await sock.sendMessage(jid, {
        document: src(plantilla.imagenUrl),
        fileName: texto || `archivo.${ext}`,
        mimetype: mimeDoc[ext] ?? "application/octet-stream",
      })
    } else if (plantilla.tipo === "audio" && plantilla.imagenUrl) {
      const mimeAudio: Record<string, string> = {
        mp3: "audio/mpeg", ogg: "audio/ogg; codecs=opus",
        m4a: "audio/mp4", wav: "audio/wav", aac: "audio/aac",
      }
      await sock.sendMessage(jid, { audio: src(plantilla.imagenUrl), mimetype: mimeAudio[ext] ?? "audio/mpeg", ptt: false })
    } else {
      await sock.sendMessage(jid, { text: texto })
    }

    console.log(`📤 Recordatorio manual → ${cuenta.telefono} (${jid})`)
    res.json({ ok: true })
  } catch (err) {
    console.error("Error recordatorio:", err)
    res.status(500).json({ error: "No se pudo enviar" })
  }
})

export default router
