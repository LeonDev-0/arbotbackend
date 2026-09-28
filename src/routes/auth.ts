import { Router } from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { prisma } from "../../lib/prisma"
import { JWT_SECRET } from "../config"
import { auth, authMiddleware } from "../middleware/auth"

const router = Router()

const USER_SELECT = { id:true, username:true, rol:true, activo:true, expiraEn:true, creadoEn:true }

router.post("/login", async (req, res) => {
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

router.get("/me", authMiddleware, async (req: any, res) => {
  res.json(await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: USER_SELECT }))
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
