import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"
import { normalizarTelefono } from "../utils/telefono"
import { getDispositivo, numeroCompletoAJid } from "../../bot"

const router = Router()

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
  res.json(await prisma.cuentaCliente.findMany({ where, orderBy: { id: "desc" }, include: { servicio: true } }))
})

router.post("/", ...auth, async (req: any, res) => {
  try {
    const { telefono, usuario, contrasena, servicioId, pais, notas } = req.body
    if (!telefono || !usuario || !contrasena || !servicioId)
      return res.status(400).json({ error: "Faltan campos requeridos" })
    res.json(await prisma.cuentaCliente.create({
      data: {
        usuarioId: req.usuario.id,
        telefono: normalizarTelefono(telefono),
        usuario, contrasena,
        servicioId: Number(servicioId),
        pais: pais ?? "Bolivia",
        notas: notas ?? null,
      },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error al crear" }) }
})

router.put("/:id", ...auth, async (req: any, res) => {
  try {
    const { telefono, usuario, contrasena, servicioId, pais, notas } = req.body
    const data: any = { usuario, contrasena, pais, notas }
    if (telefono) data.telefono = normalizarTelefono(telefono)
    if (servicioId) data.servicioId = Number(servicioId)
    res.json(await prisma.cuentaCliente.update({
      where: { id: Number(req.params.id) },
      data,
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error al actualizar" }) }
})

router.delete("/:id", ...auth, async (req, res) => {
  await prisma.cuentaCliente.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
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

    const devs = await prisma.dispositivo.findMany({ where: { usuarioId: req.usuario.id } })
    let devElegido: any = null
    for (const dev of devs) {
      const info = getDispositivo(dev.id)
      if (info?.estado === "conectado" && info?.sock) { devElegido = { dev, info }; break }
    }
    if (!devElegido) return res.status(503).json({ error: "No hay dispositivos conectados" })

    const jid = numeroCompletoAJid(cuenta.telefono)
    const texto = plantilla.mensaje
      .replace(/\{usuario\}/g, cuenta.usuario)
      .replace(/\{servicio\}/g, cuenta.servicio.nombre)
      .replace(/\{pais\}/g, cuenta.pais)

    const ext = (plantilla.imagenUrl ?? "").split(".").pop()?.toLowerCase() ?? ""

    if (plantilla.tipo === "imagen" && plantilla.imagenUrl) {
      await devElegido.info.sock.sendMessage(jid, { image: { url: plantilla.imagenUrl }, caption: texto })
    } else if (plantilla.tipo === "documento" && plantilla.imagenUrl) {
      const mimeDoc: Record<string, string> = {
        pdf: "application/pdf", doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }
      await devElegido.info.sock.sendMessage(jid, {
        document: { url: plantilla.imagenUrl },
        fileName: texto || `archivo.${ext}`,
        mimetype: mimeDoc[ext] ?? "application/octet-stream",
      })
    } else if (plantilla.tipo === "audio" && plantilla.imagenUrl) {
      const mimeAudio: Record<string, string> = {
        mp3: "audio/mpeg", ogg: "audio/ogg; codecs=opus",
        m4a: "audio/mp4", wav: "audio/wav", aac: "audio/aac",
      }
      await devElegido.info.sock.sendMessage(jid, {
        audio: { url: plantilla.imagenUrl },
        mimetype: mimeAudio[ext] ?? "audio/mpeg",
        ptt: false,
      })
    } else {
      await devElegido.info.sock.sendMessage(jid, { text: texto })
    }

    console.log(`📤 Recordatorio enviado → ${cuenta.telefono} (${jid})`)
    res.json({ ok: true })
  } catch (err) {
    console.error("Error recordatorio:", err)
    res.status(500).json({ error: "No se pudo enviar" })
  }
})

export default router
