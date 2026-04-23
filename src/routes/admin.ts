import { Router } from "express"
import bcrypt from "bcryptjs"
import { prisma } from "../../lib/prisma"
import { authMiddleware, adminOnly } from "../middleware/auth"

const router = Router()
router.use(authMiddleware, adminOnly)

const SELECT = { id:true, username:true, rol:true, activo:true, expiraEn:true, creadoEn:true }

router.get("/", async (_req, res) => {
  res.json(await prisma.usuario.findMany({ orderBy: { id: "asc" }, select: SELECT }))
})

router.post("/", async (req, res) => {
  try {
    const { username, password, rol, expiraEn } = req.body
    if (!username || !password) return res.status(400).json({ error: "username y password requeridos" })
    const hash = await bcrypt.hash(password, 10)
    const usuario = await prisma.usuario.create({
      data: { username, password: hash, rol: rol ?? "cliente", expiraEn: expiraEn ? new Date(expiraEn) : null },
      select: SELECT,
    })
    res.json(usuario)
  } catch (e: any) {
    res.status(e.code === "P2002" ? 400 : 500).json({ error: e.code === "P2002" ? "Username ya existe" : "Error" })
  }
})

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { username, password, rol, activo, expiraEn } = req.body
    const data: any = { username, rol, activo }
    if (expiraEn !== undefined) data.expiraEn = expiraEn ? new Date(expiraEn) : null
    if (password) data.password = await bcrypt.hash(password, 10)
    res.json(await prisma.usuario.update({ where: { id }, data, select: SELECT }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.put("/:id/renovar", async (req, res) => {
  try {
    const id = Number(req.params.id)
    const meses = Number(req.body.meses)
    if (![1, 3, 6, 12].includes(meses)) return res.status(400).json({ error: "Duración inválida" })
    const usuario = await prisma.usuario.findUnique({ where: { id }, select: { expiraEn: true } })
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" })
    const base = !usuario.expiraEn || new Date() > usuario.expiraEn ? new Date() : new Date(usuario.expiraEn)
    base.setMonth(base.getMonth() + meses)
    res.json(await prisma.usuario.update({ where: { id }, data: { expiraEn: base }, select: SELECT }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.delete("/:id", async (req: any, res) => {
  const id = Number(req.params.id)
  if (id === req.usuario.id) return res.status(400).json({ error: "No puedes eliminar tu propia cuenta" })
  await prisma.usuario.delete({ where: { id } })
  res.json({ ok: true })
})

export default router
