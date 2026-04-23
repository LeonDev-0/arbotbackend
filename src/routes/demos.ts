import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"

export const demosRouter = Router()
export const clientesDemoRouter = Router()

// ── Cuentas demo ──────────────────────────────────────────────────────────────

demosRouter.get("/", ...auth, async (req: any, res) => {
  const { servicioId } = req.query
  const where: any = { usuarioId: req.usuario.id }
  if (servicioId) where.servicioId = Number(servicioId)
  res.json(await prisma.cuentaDemo.findMany({ where, orderBy: { id: "desc" }, include: { servicio: true } }))
})

demosRouter.post("/", ...auth, async (req: any, res) => {
  try {
    const { servicioId, usuario, contrasena } = req.body
    if (!servicioId || !usuario || !contrasena) return res.status(400).json({ error: "Faltan campos" })
    res.json(await prisma.cuentaDemo.create({
      data: { usuarioId: req.usuario.id, servicioId: Number(servicioId), usuario, contrasena, disponible: true },
      include: { servicio: true },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

demosRouter.put("/:id", ...auth, async (req, res) => {
  try {
    const { usuario, contrasena } = req.body
    const data: any = {}
    if (usuario) data.usuario = usuario
    if (contrasena) data.contrasena = contrasena
    res.json(await prisma.cuentaDemo.update({ where: { id: Number(req.params.id) }, data, include: { servicio: true } }))
  } catch { res.status(500).json({ error: "Error" }) }
})

demosRouter.delete("/:id", ...auth, async (req, res) => {
  await prisma.cuentaDemo.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

// ── Clientes demo (registrados por el bot) ────────────────────────────────────

clientesDemoRouter.get("/", ...auth, async (req: any, res) => {
  const { servicioId, buscar } = req.query
  const where: any = { usuarioId: req.usuario.id }
  if (servicioId) where.servicioId = Number(servicioId)
  if (buscar) {
    const b = String(buscar)
    where.OR = [{ telefono: { contains: b } }, { nombre: { contains: b } }]
  }
  res.json(await prisma.clienteDemo.findMany({
    where,
    orderBy: { entregadoEn: "desc" },
    include: { cuenta: true, servicio: true },
  }))
})

clientesDemoRouter.delete("/:id", ...auth, async (req, res) => {
  await prisma.clienteDemo.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})
