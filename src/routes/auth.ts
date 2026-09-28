import { Router } from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { prisma } from "../../lib/prisma"
import { JWT_SECRET } from "../config"
import { auth, authMiddleware } from "../middleware/auth"

const router = Router()

const USER_SELECT = { id:true, username:true, rol:true, activo:true, expiraEn:true, creadoEn:true }
const PASSWORD_POR_DEFECTO = "admin123"

// ── Límite de intentos de inicio de sesión (en memoria) ──────────────────────
// Bloqueo de 15 min tras 8 fallos para un mismo usuario o 20 desde una misma IP
const VENTANA_MS = 15 * 60 * 1000
const MAX_POR_USUARIO = 8
const MAX_POR_IP = 20
const fallos = new Map<string, { n: number; desde: number }>()

function bloqueado(clave: string, max: number): boolean {
  const f = fallos.get(clave)
  if (!f) return false
  if (Date.now() - f.desde > VENTANA_MS) { fallos.delete(clave); return false }
  return f.n >= max
}
function registrarFallo(clave: string) {
  const f = fallos.get(clave)
  if (!f || Date.now() - f.desde > VENTANA_MS) fallos.set(clave, { n: 1, desde: Date.now() })
  else f.n++
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: "username y password requeridos" })
  const claveUsuario = `u:${String(username).toLowerCase()}`
  const claveIp = `ip:${req.ip}`
  if (bloqueado(claveUsuario, MAX_POR_USUARIO) || bloqueado(claveIp, MAX_POR_IP))
    return res.status(429).json({ error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo." })

  const usuario = await prisma.usuario.findUnique({ where: { username } })
  // Primero la contraseña: no revelar si una cuenta existe o está vencida a quien no la conoce
  const ok = !!usuario && await bcrypt.compare(password, usuario.password)
  if (!ok || !usuario.activo) {
    registrarFallo(claveUsuario); registrarFallo(claveIp)
    return res.status(401).json({ error: "Credenciales incorrectas" })
  }
  if (usuario.expiraEn && new Date() > usuario.expiraEn)
    return res.status(403).json({ error: "Cuenta expirada. Contacta al administrador." })

  fallos.delete(claveUsuario)
  const token = jwt.sign(
    { id: usuario.id, username: usuario.username, rol: usuario.rol },
    JWT_SECRET,
    { expiresIn: "7d" }
  )
  res.json({ token, usuario: {
    id: usuario.id, username: usuario.username, rol: usuario.rol, expiraEn: usuario.expiraEn,
    passwordPorDefecto: password === PASSWORD_POR_DEFECTO,
  } })
})

router.get("/me", authMiddleware, async (req: any, res) => {
  const u = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { ...USER_SELECT, password: true } })
  if (!u) return res.status(401).json({ error: "Sesión inválida" })
  const { password, ...datos } = u
  // Aviso en el panel mientras siga usando la contraseña por defecto
  res.json({ ...datos, passwordPorDefecto: await bcrypt.compare(PASSWORD_POR_DEFECTO, password) })
})

// Cambiar la propia contraseña (cualquier rol)
router.put("/password", ...auth, async (req: any, res) => {
  const actual = String(req.body.actual ?? "")
  const nueva  = String(req.body.nueva ?? "")
  const u = await prisma.usuario.findUnique({ where: { id: req.usuario.id } })
  if (!u || !await bcrypt.compare(actual, u.password)) return res.status(400).json({ error: "La contraseña actual no es correcta" })
  if (nueva.length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres" })
  if (nueva === PASSWORD_POR_DEFECTO || nueva === actual) return res.status(400).json({ error: "Elige una contraseña distinta" })
  await prisma.usuario.update({ where: { id: u.id }, data: { password: await bcrypt.hash(nueva, 10) } })
  res.json({ ok: true })
})

// La contraseña del panel nunca sale del servidor: solo se informa si está guardada
const panelPublico = (u: { panelUsuario: string | null; panelPassword: string | null } | null) => ({
  panelUsuario:  u?.panelUsuario ?? "",
  tienePassword: !!u?.panelPassword,
})

router.get("/panel-config", ...auth, async (req: any, res) => {
  const u = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { panelUsuario: true, panelPassword: true } })
  res.json(panelPublico(u))
})

router.put("/panel-config", ...auth, async (req: any, res) => {
  try {
    const actual = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { panelUsuario: true, panelPassword: true } })
    const nuevoUsuario  = String(req.body.panelUsuario ?? "").trim() || null
    const nuevaPassword = String(req.body.panelPassword ?? "").trim() || null // vacía = conservar la guardada

    const u = await prisma.usuario.update({
      where: { id: req.usuario.id },
      data: { panelUsuario: nuevoUsuario, ...(nuevaPassword ? { panelPassword: nuevaPassword } : {}) },
      select: { panelUsuario: true, panelPassword: true },
    })

    // Credenciales nuevas → cerrar solo la sesión del panel de este usuario (la próxima operación inicia sesión de nuevo)
    if (nuevoUsuario !== actual?.panelUsuario || (nuevaPassword && nuevaPassword !== actual?.panelPassword)) {
      const { cerrarSesionPanel } = await import("../iptvservice")
      await cerrarSesionPanel(req.usuario.id)
    }

    res.json(panelPublico(u))
  } catch { res.status(500).json({ error: "Error al guardar" }) }
})

export default router
