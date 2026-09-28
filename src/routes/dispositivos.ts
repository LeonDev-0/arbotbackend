import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth, esPropio, idPropioOpcional } from "../middleware/auth"
import { conectarDispositivo, pausarDispositivo, desconectarDispositivo, getDispositivo } from "../../bot"

const router = Router()

const NO_ENCONTRADO = { error: "Dispositivo no encontrado" }
const buscarServicio = (id: number) => prisma.servicio.findUnique({ where: { id }, select: { usuarioId: true } })
// Dispositivo del usuario (o null): todas las acciones pasan por aquí
const dispositivoPropio = async (req: any) => {
  const d = await prisma.dispositivo.findUnique({ where: { id: Number(req.params.id) } })
  return esPropio(req, d) ? d : null
}

// ── CRUD dispositivos ─────────────────────────────────────────────────────────

router.get("/", ...auth, async (req: any, res) => {
  const where = { usuarioId: req.usuario.id }
  const devs = await prisma.dispositivo.findMany({ where, orderBy: { id: "asc" }, include: { servicio: true } })
  res.json(devs.map(d => {
    const m = getDispositivo(d.id)
    return { ...d, estado: m?.estado ?? d.estado, qr: m?.qr ?? null, telefono: m?.telefono ?? d.telefono }
  }))
})

router.post("/", ...auth, async (req: any, res) => {
  try {
    const count = await prisma.dispositivo.count({ where: { usuarioId: req.usuario.id } })
    if (count >= 4) return res.status(400).json({ error: "Máximo 4 dispositivos por cuenta" })
    const { nombre, pais } = req.body
    if (!nombre?.trim()) return res.status(400).json({ error: "nombre requerido" })
    const servicioId = await idPropioOpcional(req, req.body.servicioId, buscarServicio)
    if (servicioId === false) return res.status(400).json({ error: "Servicio inválido" })
    res.json(await prisma.dispositivo.create({
      data: { usuarioId: req.usuario.id, nombre: nombre.trim(), servicioId, pais: pais ?? null },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.put("/:id", ...auth, async (req: any, res) => {
  try {
    const d = await dispositivoPropio(req)
    if (!d) return res.status(404).json(NO_ENCONTRADO)
    const servicioId = await idPropioOpcional(req, req.body.servicioId, buscarServicio)
    if (servicioId === false) return res.status(400).json({ error: "Servicio inválido" })
    const { nombre, pais } = req.body
    res.json(await prisma.dispositivo.update({
      where: { id: d.id },
      data: { nombre, servicioId, pais: pais ?? null },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.delete("/:id", ...auth, async (req: any, res) => {
  const d = await dispositivoPropio(req)
  if (!d) return res.status(404).json(NO_ENCONTRADO)
  await desconectarDispositivo(d.id).catch(() => {})
  await prisma.dispositivo.delete({ where: { id: d.id } })
  res.json({ ok: true })
})

// ── Acciones de conexión ──────────────────────────────────────────────────────

router.post("/:id/conectar", ...auth, async (req: any, res) => {
  const d = await dispositivoPropio(req)
  if (!d) return res.status(404).json(NO_ENCONTRADO)
  conectarDispositivo(d.id).catch(console.error)
  res.json({ ok: true })
})

router.post("/:id/pausar", ...auth, async (req: any, res) => {
  try {
    const d = await dispositivoPropio(req)
    if (!d) return res.status(404).json(NO_ENCONTRADO)
    await pausarDispositivo(d.id)
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "Error" }) }
})

router.post("/:id/desconectar", ...auth, async (req: any, res) => {
  try {
    const d = await dispositivoPropio(req)
    if (!d) return res.status(404).json(NO_ENCONTRADO)
    await desconectarDispositivo(d.id)
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "Error" }) }
})

export default router
