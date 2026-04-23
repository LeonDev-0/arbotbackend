import jwt from "jsonwebtoken"
import { JWT_SECRET } from "../config"
import { prisma } from "../../lib/prisma"

export function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return res.status(401).json({ error: "No autorizado" })
  try {
    req.usuario = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: "Token inválido" })
  }
}

export function adminOnly(req: any, res: any, next: any) {
  if (req.usuario?.rol !== "admin") return res.status(403).json({ error: "Solo administradores" })
  next()
}

export async function checkExpiracion(req: any, res: any, next: any) {
  if (req.usuario?.rol === "admin") return next()
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } })
  if (!usuario?.activo) return res.status(403).json({ error: "Cuenta desactivada" })
  if (usuario.expiraEn && new Date() > usuario.expiraEn)
    return res.status(403).json({ error: "Cuenta expirada. Contacta al administrador." })
  next()
}

export const auth = [authMiddleware, checkExpiracion]
