import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"

const router = Router()

router.get("/", ...auth, async (req: any, res) => {
  res.json(await prisma.plantillaRecordatorio.findMany({
    where: { usuarioId: req.usuario.id },
    orderBy: { id: "desc" },
  }))
})

router.post("/", ...auth, async (req: any, res) => {
  try {
    const { nombre, tipo, mensaje, imagenUrl } = req.body
    if (!nombre) return res.status(400).json({ error: "nombre requerido" })
    res.json(await prisma.plantillaRecordatorio.create({
      data: { usuarioId: req.usuario.id, nombre, tipo: tipo ?? "texto", mensaje, imagenUrl: imagenUrl ?? null },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.put("/:id", ...auth, async (req, res) => {
  try {
    res.json(await prisma.plantillaRecordatorio.update({ where: { id: Number(req.params.id) }, data: req.body }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.delete("/:id", ...auth, async (req, res) => {
  await prisma.plantillaRecordatorio.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

export default router
