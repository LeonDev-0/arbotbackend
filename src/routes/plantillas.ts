import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"

const router = Router()

// Solo una plantilla por país: devuelve la otra plantilla que ya usa ese país (si hay)
async function paisOcupado(usuarioId: number, paisDefault: string | null, exceptoId?: number) {
  if (!paisDefault) return null
  return prisma.plantillaRecordatorio.findFirst({
    where: { usuarioId, paisDefault, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
  })
}

router.get("/", ...auth, async (req: any, res) => {
  res.json(await prisma.plantillaRecordatorio.findMany({
    where: { usuarioId: req.usuario.id },
    orderBy: { id: "desc" },
  }))
})

router.post("/", ...auth, async (req: any, res) => {
  try {
    const { nombre, tipo, mensaje, imagenUrl, paisDefault } = req.body
    if (!nombre) return res.status(400).json({ error: "nombre requerido" })
    const pais = paisDefault || null
    const otra = await paisOcupado(req.usuario.id, pais)
    if (otra) return res.status(400).json({ error: `${pais} ya tiene la plantilla "${otra.nombre}"` })
    res.json(await prisma.plantillaRecordatorio.create({
      data: { usuarioId: req.usuario.id, nombre, tipo: tipo ?? "texto", mensaje, imagenUrl: imagenUrl ?? null, paisDefault: pais },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.put("/:id", ...auth, async (req: any, res) => {
  try {
    const id = Number(req.params.id)
    const p = await prisma.plantillaRecordatorio.findUnique({ where: { id } })
    if (!p || p.usuarioId !== req.usuario.id) return res.status(404).json({ error: "Plantilla no encontrada" })
    const { nombre, tipo, mensaje, imagenUrl, paisDefault } = req.body
    const pais = paisDefault || null
    // Si ya tenía ese país se deja guardar (datos anteriores a esta regla pueden tener duplicados)
    const otra = pais !== p.paisDefault ? await paisOcupado(req.usuario.id, pais, id) : null
    if (otra) return res.status(400).json({ error: `${pais} ya tiene la plantilla "${otra.nombre}"` })
    res.json(await prisma.plantillaRecordatorio.update({
      where: { id },
      data: { nombre, tipo, mensaje, imagenUrl: imagenUrl ?? null, paisDefault: pais },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.delete("/:id", ...auth, async (req, res) => {
  await prisma.plantillaRecordatorio.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

export default router
