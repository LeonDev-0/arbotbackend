import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"

// Demos entregadas por el bot (creadas en el panel IPTV)
export const clientesDemoRouter = Router()

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

// Eliminar: borra la cuenta demo (el registro del cliente se borra en cascada) → puede pedir otra
clientesDemoRouter.delete("/:id", ...auth, async (req: any, res) => {
  const demo = await prisma.clienteDemo.findUnique({ where: { id: Number(req.params.id) } })
  if (!demo || demo.usuarioId !== req.usuario.id) return res.status(404).json({ error: "Demo no encontrada" })
  await prisma.cuentaDemo.delete({ where: { id: demo.cuentaId } })
  res.json({ ok: true })
})

clientesDemoRouter.delete("/", ...auth, async (req: any, res) => {
  const { count } = await prisma.cuentaDemo.deleteMany({ where: { usuarioId: req.usuario.id } })
  res.json({ ok: true, count })
})
