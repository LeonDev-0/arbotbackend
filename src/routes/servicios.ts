import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"
import { validarCodigos, clavesRegla } from "../utils/codigosDemo"

const router = Router()

const ADULTOS = ["preguntar", "si", "no"]
const PLANES_DEMO = ["DEMO 3 HORAS", "DEMO 1 HORA"] // nombres exactos en el panel
const texto = (v: any) => (typeof v === "string" && v.trim()) || null

// Campos editables de un servicio (mismo mapeo al crear y al editar)
function datosServicio(b: any) {
  return {
    nombre:             b.nombre?.trim(),
    color:              b.color ?? "#22c55e",
    tieneRecordatorios: b.tieneRecordatorios !== false,
    demosActivo:        b.demosActivo !== false,
    planDemo:           PLANES_DEMO.includes(b.planDemo) ? b.planDemo : PLANES_DEMO[0],
    adultos:            ADULTOS.includes(b.adultos) ? b.adultos : "preguntar",
    codigoDemo:           String(b.codigoDemo ?? "22").trim(),
    codigoDemoAdultos:    String(b.codigoDemoAdultos ?? "23").trim(),
    codigoDemoSinAdultos: String(b.codigoDemoSinAdultos ?? "24").trim(),
    msgDemoEntregada:   texto(b.msgDemoEntregada),
    msgDemoYaTiene:     texto(b.msgDemoYaTiene),
    msgDemoDesactivado: texto(b.msgDemoDesactivado),
    imagenDespuesDemo:        texto(b.imagenDespuesDemo),
    captionImagenDespuesDemo: texto(b.captionImagenDespuesDemo),
    smartersNombre: texto(b.smartersNombre),
    smartersUrl:    texto(b.smartersUrl),
    iphoneUrl:      texto(b.iphoneUrl),
  }
}

router.get("/", ...auth, async (req: any, res) => {
  const where = { usuarioId: req.usuario.id }
  res.json(await prisma.servicio.findMany({ where, orderBy: { nombre: "asc" } }))
})

router.post("/", ...auth, async (req: any, res) => {
  try {
    const data = datosServicio(req.body)
    const error = validarCodigos(data, [])
    if (error) return res.status(400).json({ error })
    res.json(await prisma.servicio.create({
      data: { usuarioId: req.usuario.id, ...data },
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
    const data = datosServicio(req.body)
    const reglas = await prisma.respuestaRegla.findMany({ where: { servicioId: s.id }, select: { palabrasClave: true } })
    const error = validarCodigos(data, reglas.flatMap(r => clavesRegla(r.palabrasClave)))
    if (error) return res.status(400).json({ error })
    res.json(await prisma.servicio.update({
      where: { id: s.id },
      data,
    }))
  } catch (e: any) {
    res.status(e.code === "P2002" ? 400 : 500).json({ error: e.code === "P2002" ? "Nombre ya existe" : "Error" })
  }
})

router.get("/:id/reglas", ...auth, async (req: any, res) => {
  const s = await prisma.servicio.findUnique({ where: { id: Number(req.params.id) } })
  if (!s || (req.usuario.rol !== "admin" && s.usuarioId !== req.usuario.id))
    return res.status(403).json({ error: "Sin permisos" })
  res.json(await prisma.respuestaRegla.findMany({
    where: { servicioId: Number(req.params.id) },
    orderBy: { orden: "asc" },
    include: { pasos: { orderBy: { orden: "asc" } } },
  }))
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
