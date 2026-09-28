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

/* ¿El registro pertenece al usuario de la petición? (el admin puede operar sobre todo).
   Si no, las rutas responden 404: no revelan que el registro existe. */
export const esPropio = (req: any, registro: { usuarioId: number } | null | undefined): boolean =>
  !!registro && (req.usuario?.rol === "admin" || registro.usuarioId === req.usuario?.id)

/* Un id opcional (servicio, plantilla…) debe ser null o de un registro propio */
export async function idPropioOpcional(
  req: any, id: unknown, buscar: (id: number) => Promise<{ usuarioId: number } | null>,
): Promise<number | null | false> {
  if (id === null || id === undefined || id === "") return null
  const n = Number(id)
  if (!Number.isInteger(n)) return false
  return esPropio(req, await buscar(n)) ? n : false
}
