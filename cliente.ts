import express from "express"
import cors from "cors"
import multer from "multer"
import path from "path"
import fs from "fs"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { prisma } from "./lib/prisma"
import {
  iniciarBots,
  conectarDispositivo,
  pausarDispositivo,
  desconectarDispositivo,
  getDispositivo,
  detectarPais,
  numeroCompletoAJid,
} from "./bot"

const app = express()
app.use(cors())
app.use(express.json())

const JWT_SECRET = process.env.JWT_SECRET ?? "demo-bot-secret-2024"

const uploadsDir = path.resolve("uploads")
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir)
app.use("/uploads", express.static(uploadsDir))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
})

iniciarBots()

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */

/**
 * Normaliza cualquier input de teléfono del frontend al formato canónico
 * que usa el bot: "591 64598912"
 *
 * Acepta cualquiera de:
 *   - "59164598912"        → detecta país → "591 64598912"
 *   - "+591 64598912"      → limpia y detecta → "591 64598912"
 *   - "591 64598912"       → ya está en formato correcto → "591 64598912"
 *   - "64598912"           → sin código de país → se guarda tal cual
 */
function normalizarTelefono(telefono: string): string {
  // Quitar +, espacios, guiones para pasar por detectarPais
  const limpio = telefono.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "")
  const { numeroCompleto } = detectarPais(limpio)
  return numeroCompleto
}

/* ════════════════════════════════════════════
   AUTH MIDDLEWARE
════════════════════════════════════════════ */
function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return res.status(401).json({ error: "No autorizado" })
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any
    req.usuario = payload
    next()
  } catch {
    res.status(401).json({ error: "Token inválido" })
  }
}

function adminOnly(req: any, res: any, next: any) {
  if (req.usuario?.rol !== "admin") return res.status(403).json({ error: "Solo administradores" })
  next()
}

async function checkExpiracion(req: any, res: any, next: any) {
  if (req.usuario?.rol === "admin") return next()
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } })
  if (!usuario?.activo) return res.status(403).json({ error: "Cuenta desactivada" })
  if (usuario.expiraEn && new Date() > usuario.expiraEn)
    return res.status(403).json({ error: "Cuenta expirada. Contacta al administrador." })
  next()
}

const auth = [authMiddleware, checkExpiracion]

/* ════════════════════════════════════════════
   AUTH ENDPOINTS
════════════════════════════════════════════ */
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: "username y password requeridos" })
  const usuario = await prisma.usuario.findUnique({ where: { username } })
  if (!usuario || !usuario.activo) return res.status(401).json({ error: "Credenciales incorrectas" })
  if (usuario.expiraEn && new Date() > usuario.expiraEn)
    return res.status(403).json({ error: "Cuenta expirada. Contacta al administrador." })
  const ok = await bcrypt.compare(password, usuario.password)
  if (!ok) return res.status(401).json({ error: "Credenciales incorrectas" })
  const token = jwt.sign(
    { id: usuario.id, username: usuario.username, rol: usuario.rol },
    JWT_SECRET,
    { expiresIn: "7d" }
  )
  res.json({ token, usuario: { id: usuario.id, username: usuario.username, rol: usuario.rol, expiraEn: usuario.expiraEn } })
})

app.get("/auth/me", authMiddleware, async (req: any, res) => {
  const u = await prisma.usuario.findUnique({
    where: { id: req.usuario.id },
    select: { id:true, username:true, rol:true, activo:true, expiraEn:true, creadoEn:true },
  })
  res.json(u)
})

/* ════════════════════════════════════════════
   ADMIN: GESTIÓN DE CUENTAS
════════════════════════════════════════════ */
app.get("/admin/usuarios", authMiddleware, adminOnly, async (_req, res) => {
  const usuarios = await prisma.usuario.findMany({
    orderBy: { id: "asc" },
    select: { id:true, username:true, rol:true, activo:true, expiraEn:true, creadoEn:true },
  })
  res.json(usuarios)
})

app.post("/admin/usuarios", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, rol, expiraEn } = req.body
    if (!username || !password) return res.status(400).json({ error: "username y password requeridos" })
    const hash = await bcrypt.hash(password, 10)
    const usuario = await prisma.usuario.create({
      data: { username, password: hash, rol: rol ?? "cliente", expiraEn: expiraEn ? new Date(expiraEn) : null },
      select: { id:true, username:true, rol:true, activo:true, expiraEn:true, creadoEn:true },
    })
    res.json(usuario)
  } catch (e: any) {
    res.status(e.code === "P2002" ? 400 : 500).json({ error: e.code === "P2002" ? "Username ya existe" : "Error" })
  }
})

app.put("/admin/usuarios/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { username, password, rol, activo, expiraEn } = req.body
    const data: any = { username, rol, activo }
    if (expiraEn !== undefined) data.expiraEn = expiraEn ? new Date(expiraEn) : null
    if (password) data.password = await bcrypt.hash(password, 10)
    const u = await prisma.usuario.update({
      where: { id }, data,
      select: { id:true, username:true, rol:true, activo:true, expiraEn:true, creadoEn:true },
    })
    res.json(u)
  } catch { res.status(500).json({ error: "Error" }) }
})

app.put("/admin/usuarios/:id/renovar", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const meses = Number(req.body.meses)
    if (![1, 3, 6, 12].includes(meses)) return res.status(400).json({ error: "Duración inválida" })
    const usuario = await prisma.usuario.findUnique({ where: { id }, select: { expiraEn: true } })
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" })
    const base = !usuario.expiraEn || new Date() > usuario.expiraEn ? new Date() : new Date(usuario.expiraEn)
    base.setMonth(base.getMonth() + meses)
    const u = await prisma.usuario.update({
      where: { id }, data: { expiraEn: base },
      select: { id:true, username:true, rol:true, activo:true, expiraEn:true, creadoEn:true },
    })
    res.json(u)
  } catch { res.status(500).json({ error: "Error" }) }
})

app.delete("/admin/usuarios/:id", authMiddleware, adminOnly, async (req: any, res) => {
  const id = Number(req.params.id)
  if (id === req.usuario.id) return res.status(400).json({ error: "No puedes eliminar tu propia cuenta" })
  await prisma.usuario.delete({ where: { id } })
  res.json({ ok: true })
})

/* ════════════════════════════════════════════
   UPLOAD
════════════════════════════════════════════ */
app.post("/upload", ...auth, upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió archivo" })
  res.json({ url: `http://localhost:3001/uploads/${req.file.filename}` })
})

/* ════════════════════════════════════════════
   SERVICIOS
════════════════════════════════════════════ */
app.get("/servicios", ...auth, async (req: any, res) => {
  const where = req.usuario.rol === "admin" ? {} : { usuarioId: req.usuario.id }
  res.json(await prisma.servicio.findMany({ where, orderBy: { nombre: "asc" } }))
})

app.post("/servicios", ...auth, async (req: any, res) => {
  try {
    res.json(await prisma.servicio.create({
      data: { usuarioId: req.usuario.id, nombre: req.body.nombre?.trim(), color: req.body.color ?? "#22c55e" },
    }))
  } catch (e: any) {
    res.status(e.code === "P2002" ? 400 : 500).json({ error: e.code === "P2002" ? "Nombre ya existe" : "Error" })
  }
})

app.put("/servicios/:id", ...auth, async (req: any, res) => {
  try {
    const s = await prisma.servicio.findUnique({ where: { id: Number(req.params.id) } })
    if (!s || (req.usuario.rol !== "admin" && s.usuarioId !== req.usuario.id))
      return res.status(403).json({ error: "Sin permisos" })
    res.json(await prisma.servicio.update({
      where: { id: Number(req.params.id) },
      data: { nombre: req.body.nombre, color: req.body.color },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

app.delete("/servicios/:id", ...auth, async (req: any, res) => {
  try {
    const s = await prisma.servicio.findUnique({ where: { id: Number(req.params.id) } })
    if (!s || (req.usuario.rol !== "admin" && s.usuarioId !== req.usuario.id))
      return res.status(403).json({ error: "Sin permisos" })
    await prisma.servicio.delete({ where: { id: Number(req.params.id) } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "No se puede eliminar" }) }
})

/* ════════════════════════════════════════════
   DISPOSITIVOS (máx 2 por usuario)
════════════════════════════════════════════ */
app.get("/dispositivos", ...auth, async (req: any, res) => {
  const where = req.usuario.rol === "admin" ? {} : { usuarioId: req.usuario.id }
  const devs = await prisma.dispositivo.findMany({ where, orderBy: { id: "asc" }, include: { servicio: true } })
  res.json(devs.map(d => {
    const m = getDispositivo(d.id)
    return { ...d, estado: m?.estado ?? d.estado, qr: m?.qr ?? null, telefono: m?.telefono ?? d.telefono }
  }))
})

app.post("/dispositivos", ...auth, async (req: any, res) => {
  try {
    const count = await prisma.dispositivo.count({ where: { usuarioId: req.usuario.id } })
    if (count >= 2) return res.status(400).json({ error: "Máximo 2 dispositivos por cuenta" })
    const { nombre, servicioId, pais } = req.body
    if (!nombre?.trim()) return res.status(400).json({ error: "nombre requerido" })
    res.json(await prisma.dispositivo.create({
      data: { usuarioId: req.usuario.id, nombre: nombre.trim(), servicioId: servicioId ?? null, pais: pais ?? null },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

app.put("/dispositivos/:id", ...auth, async (req: any, res) => {
  try {
    const d = await prisma.dispositivo.findUnique({ where: { id: Number(req.params.id) } })
    if (!d || (req.usuario.rol !== "admin" && d.usuarioId !== req.usuario.id))
      return res.status(403).json({ error: "Sin permisos" })
    const { nombre, servicioId, pais } = req.body
    res.json(await prisma.dispositivo.update({
      where: { id: Number(req.params.id) },
      data: { nombre, servicioId: servicioId ?? null, pais: pais ?? null },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

app.delete("/dispositivos/:id", ...auth, async (req: any, res) => {
  const id = Number(req.params.id)
  const d = await prisma.dispositivo.findUnique({ where: { id } })
  if (!d || (req.usuario.rol !== "admin" && d.usuarioId !== req.usuario.id))
    return res.status(403).json({ error: "Sin permisos" })
  await desconectarDispositivo(id).catch(() => {})
  await prisma.dispositivo.delete({ where: { id } })
  res.json({ ok: true })
})

app.post("/dispositivos/:id/conectar", ...auth, async (req: any, res) => {
  const id = Number(req.params.id)
  const d = await prisma.dispositivo.findUnique({ where: { id } })
  if (!d || (req.usuario.rol !== "admin" && d.usuarioId !== req.usuario.id))
    return res.status(403).json({ error: "Sin permisos" })
  conectarDispositivo(id).catch(console.error)
  res.json({ ok: true })
})

app.post("/dispositivos/:id/pausar", ...auth, async (req: any, res) => {
  try {
    const id = Number(req.params.id)
    const d = await prisma.dispositivo.findUnique({ where: { id } })
    if (!d || (req.usuario.rol !== "admin" && d.usuarioId !== req.usuario.id))
      return res.status(403).json({ error: "Sin permisos" })
    await pausarDispositivo(id)
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "Error" }) }
})

app.post("/dispositivos/:id/desconectar", ...auth, async (req: any, res) => {
  try {
    await desconectarDispositivo(Number(req.params.id))
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "Error" }) }
})

/* ════════════════════════════════════════════
   REGLAS Y PASOS
════════════════════════════════════════════ */
app.get("/dispositivos/:id/reglas", ...auth, async (req, res) => {
  res.json(await prisma.respuestaRegla.findMany({
    where: { dispositivoId: Number(req.params.id) },
    orderBy: { orden: "asc" },
    include: { pasos: { orderBy: { orden: "asc" } } },
  }))
})
app.post("/dispositivos/:id/reglas", ...auth, async (req, res) => {
  try {
    const dispositivoId = Number(req.params.id)
    const count = await prisma.respuestaRegla.count({ where: { dispositivoId } })
    res.json(await prisma.respuestaRegla.create({
      data: { dispositivoId, palabrasClave: req.body.palabrasClave?.trim(), orden: count },
      include: { pasos: true },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})
app.put("/reglas/:id", ...auth, async (req, res) => {
  try {
    res.json(await prisma.respuestaRegla.update({
      where: { id: Number(req.params.id) },
      data: req.body,
      include: { pasos: { orderBy: { orden: "asc" } } },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})
app.delete("/reglas/:id", ...auth, async (req, res) => {
  await prisma.respuestaRegla.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})
app.post("/reglas/:id/pasos", ...auth, async (req, res) => {
  try {
    const reglaId = Number(req.params.id)
    const count = await prisma.respuestaPaso.count({ where: { reglaId } })
    res.json(await prisma.respuestaPaso.create({
      data: {
        reglaId,
        tipo: req.body.tipo ?? "texto",
        contenido: req.body.contenido?.trim(),
        caption: req.body.caption ?? null,
        delayMs: req.body.delayMs ?? 0,
        orden: count,
      },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})
app.put("/pasos/:id", ...auth, async (req, res) => {
  try { res.json(await prisma.respuestaPaso.update({ where: { id: Number(req.params.id) }, data: req.body })) }
  catch { res.status(500).json({ error: "Error" }) }
})
app.delete("/pasos/:id", ...auth, async (req, res) => {
  await prisma.respuestaPaso.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

/* ════════════════════════════════════════════
   PLANTILLAS DE RECORDATORIO
════════════════════════════════════════════ */
app.get("/plantillas", ...auth, async (req: any, res) => {
  res.json(await prisma.plantillaRecordatorio.findMany({
    where: { usuarioId: req.usuario.id },
    orderBy: { id: "desc" },
  }))
})
app.post("/plantillas", ...auth, async (req: any, res) => {
  try {
    const { nombre, tipo, mensaje, imagenUrl } = req.body
    if (!nombre) return res.status(400).json({ error: "nombre requerido" })
    res.json(await prisma.plantillaRecordatorio.create({
      data: { usuarioId: req.usuario.id, nombre, tipo: tipo ?? "texto", mensaje, imagenUrl: imagenUrl ?? null },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})
app.put("/plantillas/:id", ...auth, async (req, res) => {
  try { res.json(await prisma.plantillaRecordatorio.update({ where: { id: Number(req.params.id) }, data: req.body })) }
  catch { res.status(500).json({ error: "Error" }) }
})
app.delete("/plantillas/:id", ...auth, async (req, res) => {
  await prisma.plantillaRecordatorio.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

/* ════════════════════════════════════════════
   CUENTAS CLIENTES
   Teléfono se guarda en formato "591 64598912"
════════════════════════════════════════════ */
app.get("/cuentas-clientes", ...auth, async (req: any, res) => {
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
  res.json(await prisma.cuentaCliente.findMany({
    where,
    orderBy: { id: "desc" },
    include: { servicio: true },
  }))
})

app.post("/cuentas-clientes", ...auth, async (req: any, res) => {
  try {
    const { telefono, usuario, contrasena, servicioId, pais, notas } = req.body
    if (!telefono || !usuario || !contrasena || !servicioId)
      return res.status(400).json({ error: "Faltan campos requeridos" })

    // Normalizar al formato "591 64598912"
    const telefonoNorm = normalizarTelefono(telefono)

    res.json(await prisma.cuentaCliente.create({
      data: {
        usuarioId: req.usuario.id,
        telefono: telefonoNorm,
        usuario,
        contrasena,
        servicioId: Number(servicioId),
        pais: pais ?? "Bolivia",
        notas: notas ?? null,
      },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error al crear" }) }
})

app.put("/cuentas-clientes/:id", ...auth, async (req: any, res) => {
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

app.delete("/cuentas-clientes/:id", ...auth, async (req, res) => {
  await prisma.cuentaCliente.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

/* ── Enviar recordatorio ── */
app.post("/cuentas-clientes/:id/recordatorio", ...auth, async (req: any, res) => {
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

    // Buscar dispositivo conectado del mismo usuario
    const devs = await prisma.dispositivo.findMany({ where: { usuarioId: req.usuario.id } })
    let devElegido: any = null
    for (const dev of devs) {
      const info = getDispositivo(dev.id)
      if (info?.estado === "conectado" && info?.sock) { devElegido = { dev, info }; break }
    }
    if (!devElegido) return res.status(503).json({ error: "No hay dispositivos conectados" })

    // Construir JID desde el numero en formato "591 64598912"
    // → quitar espacios/guiones → "59164598912" → "59164598912@s.whatsapp.net"
    const jid = numeroCompletoAJid(cuenta.telefono)

    const texto = plantilla.mensaje
      .replace(/\{usuario\}/g, cuenta.usuario)
      .replace(/\{servicio\}/g, cuenta.servicio.nombre)
      .replace(/\{pais\}/g, cuenta.pais)

    const ext = (plantilla.imagenUrl ?? '').split('.').pop()?.toLowerCase() ?? ''
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

/* ════════════════════════════════════════════
   DEMOS
════════════════════════════════════════════ */
app.get("/demos", ...auth, async (req: any, res) => {
  const { servicioId } = req.query
  const where: any = { usuarioId: req.usuario.id }
  if (servicioId) where.servicioId = Number(servicioId)
  res.json(await prisma.cuentaDemo.findMany({ where, orderBy: { id: "desc" }, include: { servicio: true } }))
})
app.post("/demos", ...auth, async (req: any, res) => {
  try {
    const { servicioId, usuario, contrasena } = req.body
    if (!servicioId || !usuario || !contrasena) return res.status(400).json({ error: "Faltan campos" })
    res.json(await prisma.cuentaDemo.create({
      data: { usuarioId: req.usuario.id, servicioId: Number(servicioId), usuario, contrasena, disponible: true },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

app.put("/demos/:id", ...auth, async (req, res) => {
  try {
    const { usuario, contrasena } = req.body
    const data: any = {}
    if (usuario) data.usuario = usuario
    if (contrasena) data.contrasena = contrasena
    res.json(await prisma.cuentaDemo.update({ where: { id: Number(req.params.id) }, data, include: { servicio: true } }))
  } catch { res.status(500).json({ error: "Error" }) }
})
app.delete("/demos/:id", ...auth, async (req, res) => {
  await prisma.cuentaDemo.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

/* ════════════════════════════════════════════
   CLIENTES DEMO (registro automático del bot)
════════════════════════════════════════════ */
app.get("/clientes-demo", ...auth, async (req: any, res) => {
  const { servicioId, buscar } = req.query
  const where: any = { usuarioId: req.usuario.id }
  if (servicioId) where.servicioId = Number(servicioId)
  if (buscar) {
    const b = String(buscar)
    where.OR = [{ telefono: { contains: b } }, { nombre: { contains: b } }]
  }
  res.json(await prisma.clienteDemo.findMany({
    where,
    orderBy: { entregadoEn: "desc" },
    include: { cuenta: true, servicio: true },
  }))
})
app.delete("/clientes-demo/:id", ...auth, async (req, res) => {
  await prisma.clienteDemo.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

/* ════════════════════════════════════════════
   SEED: crear admin si no existe
════════════════════════════════════════════ */
async function seedAdmin() {
  const existe = await prisma.usuario.findUnique({ where: { username: "admin" } })
  if (!existe) {
    const hash = await bcrypt.hash("admin123", 10)
    await prisma.usuario.create({ data: { username: "admin", password: hash, rol: "admin", activo: true } })
    console.log("👤 Admin creado — usuario: admin / contraseña: admin123")
  }
}

app.listen(3001, async () => {
  await seedAdmin()
  console.log("🚀 http://localhost:3001")
})