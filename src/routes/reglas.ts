import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"

export const reglasRouter = Router()
export const pasosRouter = Router()

// ── Reglas standalone ─────────────────────────────────────────────────────────

reglasRouter.put("/:id", ...auth, async (req, res) => {
  try {
    res.json(await prisma.respuestaRegla.update({
      where: { id: Number(req.params.id) },
      data: req.body,
      include: { pasos: { orderBy: { orden: "asc" } } },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

reglasRouter.delete("/:id", ...auth, async (req, res) => {
  await prisma.respuestaRegla.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

reglasRouter.post("/:id/pasos", ...auth, async (req, res) => {
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

// ── Pasos standalone ──────────────────────────────────────────────────────────

pasosRouter.put("/:id", ...auth, async (req, res) => {
  try {
    res.json(await prisma.respuestaPaso.update({ where: { id: Number(req.params.id) }, data: req.body }))
  } catch { res.status(500).json({ error: "Error" }) }
})

pasosRouter.delete("/:id", ...auth, async (req, res) => {
  await prisma.respuestaPaso.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})
