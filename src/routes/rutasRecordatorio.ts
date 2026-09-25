import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"
import { detectarPais, getDispositivo, PAISES_BOT } from "../../bot"

// Configuración "Envío de recordatorios": qué número envía a los clientes de cada país
const router = Router()

router.get("/", ...auth, async (req: any, res) => {
  const usuarioId = req.usuario.id
  const [rutas, devs, cuentas] = await Promise.all([
    prisma.rutaRecordatorio.findMany({ where: { usuarioId } }),
    prisma.dispositivo.findMany({ where: { usuarioId }, orderBy: { id: "asc" } }),
    prisma.cuentaCliente.findMany({ where: { usuarioId }, select: { telefono: true } }),
  ])

  // Clientes por país (según prefijo del teléfono) para avisar de países sin configurar
  const clientesPorPais: Record<string, number> = {}
  for (const c of cuentas) {
    const { pais } = detectarPais(c.telefono)
    clientesPorPais[pais] = (clientesPorPais[pais] ?? 0) + 1
  }

  res.json({
    rutas: rutas.map(r => ({ pais: r.pais, dispositivoId: r.dispositivoId })),
    dispositivos: devs.map(d => {
      const m = getDispositivo(d.id)
      return { id: d.id, nombre: d.nombre, telefono: m?.telefono ?? d.telefono, estado: m?.estado ?? d.estado }
    }),
    clientesPorPais,
    paises: PAISES_BOT,
  })
})

// Asigna (o cambia) el número de un país. dispositivoId null → quita la configuración
router.put("/", ...auth, async (req: any, res) => {
  try {
    const usuarioId = req.usuario.id
    const pais = String(req.body.pais ?? "").trim()
    const dispositivoId = req.body.dispositivoId ? Number(req.body.dispositivoId) : null
    if (!pais) return res.status(400).json({ error: "País requerido" })

    if (!dispositivoId) {
      await prisma.rutaRecordatorio.deleteMany({ where: { usuarioId, pais } })
      return res.json({ ok: true })
    }

    const dev = await prisma.dispositivo.findUnique({ where: { id: dispositivoId } })
    if (!dev || dev.usuarioId !== usuarioId) return res.status(400).json({ error: "Dispositivo inválido" })

    await prisma.rutaRecordatorio.upsert({
      where: { usuarioId_pais: { usuarioId, pais } },
      update: { dispositivoId },
      create: { usuarioId, pais, dispositivoId },
    })
    console.log(`📤 [rutas] Usuario ${usuarioId}: recordatorios a ${pais} → dispositivo ${dispositivoId}`)
    res.json({ ok: true })
  } catch { res.status(500).json({ error: "Error al guardar" }) }
})

export default router
