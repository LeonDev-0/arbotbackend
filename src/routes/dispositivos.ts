import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"
import { conectarDispositivo, pausarDispositivo, desconectarDispositivo, getDispositivo } from "../../bot"

const router = Router()

// ── CRUD dispositivos ─────────────────────────────────────────────────────────

router.get("/", ...auth, async (req: any, res) => {
  const where = req.usuario.rol === "admin" ? {} : { usuarioId: req.usuario.id }
  const devs = await prisma.dispositivo.findMany({ where, orderBy: { id: "asc" }, include: { servicio: true } })
  res.json(devs.map(d => {
    const m = getDispositivo(d.id)
    return { ...d, estado: m?.estado ?? d.estado, qr: m?.qr ?? null, telefono: m?.telefono ?? d.telefono }
  }))
})

router.post("/", ...auth, async (req: any, res) => {
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

router.put("/:id", ...auth, async (req: any, res) => {
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

router.delete("/:id", ...auth, async (req: any, res) => {
  const id = Number(req.params.id)
  const d = await prisma.dispositivo.findUnique({ where: { id } })
  if (!d || (req.usuario.rol !== "admin" && d.usuarioId !== req.usuario.id))
    return res.status(403).json({ error: "Sin permisos" })
  await desconectarDispositivo(id).catch(() => {})
  await prisma.dispositivo.delete({ where: { id } })
  res.json({ ok: true })
})

// ── Acciones de conexión ──────────────────────────────────────────────────────

router.post("/:id/conectar", ...auth, async (req: any, res) => {
  const id = Number(req.params.id)
  const d = await prisma.dispositivo.findUnique({ where: { id } })
  if (!d || (req.usuario.rol !== "admin" && d.usuarioId !== req.usuario.id))
    return res.status(403).json({ error: "Sin permisos" })
  conectarDispositivo(id).catch(console.error)
  res.json({ ok: true })
})

router.post("/:id/pausar", ...auth, async (req: any, res) => {
  try {
    const id = Number(req.params.id)
    const d = await prisma.dispositivo.findUnique({ where: { id } })
    if (!d || (req.usuario.rol !== "admin" && d.usuarioId !== req.usuario.id))
      return res.status(403).json({ error: "Sin permisos" })
    await pausarDispositivo(id)
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "Error" }) }
})

router.post("/:id/desconectar", ...auth, async (_req, res) => {
  try {
    await desconectarDispositivo(Number(_req.params.id))
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "Error" }) }
})

// ── Reglas del dispositivo ────────────────────────────────────────────────────

router.get("/:id/reglas", ...auth, async (req, res) => {
  res.json(await prisma.respuestaRegla.findMany({
    where: { dispositivoId: Number(req.params.id) },
    orderBy: { orden: "asc" },
    include: { pasos: { orderBy: { orden: "asc" } } },
  }))
})

router.post("/:id/reglas", ...auth, async (req, res) => {
  try {
    const dispositivoId = Number(req.params.id)
    const count = await prisma.respuestaRegla.count({ where: { dispositivoId } })
    res.json(await prisma.respuestaRegla.create({
      data: { dispositivoId, palabrasClave: req.body.palabrasClave?.trim(), orden: count },
      include: { pasos: true },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

export default router
