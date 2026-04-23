import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"

const router = Router()

router.get("/", ...auth, async (req: any, res) => {
  const where = req.usuario.rol === "admin" ? {} : { usuarioId: req.usuario.id }
  res.json(await prisma.servicio.findMany({ where, orderBy: { nombre: "asc" } }))
})

router.post("/", ...auth, async (req: any, res) => {
  try {
    const { nombre, color, demosActivo, msgDemoEntregada, msgDemoYaTiene, msgDemoSinStock, msgDemoDesactivado } = req.body
    res.json(await prisma.servicio.create({
      data: {
        usuarioId: req.usuario.id,
        nombre: nombre?.trim(),
        color: color ?? "#22c55e",
        demosActivo: demosActivo !== false,
        msgDemoEntregada:   msgDemoEntregada?.trim()   || null,
        msgDemoYaTiene:     msgDemoYaTiene?.trim()     || null,
        msgDemoSinStock:    msgDemoSinStock?.trim()    || null,
        msgDemoDesactivado: msgDemoDesactivado?.trim() || null,
      },
    }))
  } catch (e: any) {
    res.status(e.code === "P2002" ? 400 : 500).json({ error: e.code === "P2002" ? "Nombre ya existe" : "Error" })
  }
})

router.put("/:id", ...auth, async (req: any, res) => {
  try {
    const s = await prisma.servicio.findUnique({ where: { id: Number(req.params.id) } })
    if (!s || (req.usuario.rol !== "admin" && s.usuarioId !== req.usuario.id))
      return res.status(403).json({ error: "Sin permisos" })
    const { nombre, color, demosActivo, msgDemoEntregada, msgDemoYaTiene, msgDemoSinStock, msgDemoDesactivado } = req.body
    res.json(await prisma.servicio.update({
      where: { id: Number(req.params.id) },
      data: {
        nombre,
        color,
        demosActivo: demosActivo !== false,
        msgDemoEntregada:   msgDemoEntregada?.trim()   || null,
        msgDemoYaTiene:     msgDemoYaTiene?.trim()     || null,
        msgDemoSinStock:    msgDemoSinStock?.trim()    || null,
        msgDemoDesactivado: msgDemoDesactivado?.trim() || null,
      },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.delete("/:id", ...auth, async (req: any, res) => {
  try {
    const s = await prisma.servicio.findUnique({ where: { id: Number(req.params.id) } })
    if (!s || (req.usuario.rol !== "admin" && s.usuarioId !== req.usuario.id))
      return res.status(403).json({ error: "Sin permisos" })
    await prisma.servicio.delete({ where: { id: Number(req.params.id) } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "No se puede eliminar" }) }
})

export default router
