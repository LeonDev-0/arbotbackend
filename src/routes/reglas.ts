import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth } from "../middleware/auth"
import { clavesRegla, normalizarCodigo } from "../utils/codigosDemo"

export const reglasRouter = Router()

// ── Guardado completo (editor de respuestas: palabras clave + pasos de una vez) ──

const TIPOS_PASO = ["texto", "imagen", "video", "audio", "documento"]
const MAX_DELAY_MS = 30_000

type PasoEntrada = { tipo: string; contenido: string; caption?: string | null; delayMs?: number }

/* Valida una respuesta completa. Devuelve el mensaje de error o null.
   reglaId: la regla que se edita (se excluye al buscar palabras repetidas). */
async function validarRegla(
  servicio: { id: number; codigoDemo: string; codigoDemoAdultos: string; codigoDemoSinAdultos: string },
  claves: string[], pasos: PasoEntrada[], reglaId: number | null,
): Promise<string | null> {
  if (!claves.length) return "Agrega al menos una palabra clave"
  if (claves.some(c => c.includes(","))) return "Las palabras clave no pueden tener comas"
  const codigos = [servicio.codigoDemo, servicio.codigoDemoAdultos, servicio.codigoDemoSinAdultos].map(normalizarCodigo)
  const codigo = claves.find(c => codigos.includes(c))
  if (codigo) return `"${codigo}" es un código de demo de este servicio`

  // Una palabra en dos respuestas: solo funcionaría la primera
  const otras = await prisma.respuestaRegla.findMany({
    where: { servicioId: servicio.id, ...(reglaId ? { id: { not: reglaId } } : {}) },
    select: { palabrasClave: true },
  })
  const usadas = new Set(otras.flatMap(r => clavesRegla(r.palabrasClave)))
  const repetida = claves.find(c => usadas.has(c))
  if (repetida) return `"${repetida}" ya está en otra respuesta automática`

  if (!pasos.length) return "Agrega al menos un mensaje de respuesta"
  for (const [i, p] of pasos.entries()) {
    if (!TIPOS_PASO.includes(p.tipo)) return `Mensaje ${i + 1}: tipo inválido`
    const contenido = p.contenido?.trim()
    if (!contenido) return `Mensaje ${i + 1}: ${p.tipo === "texto" ? "escribe el texto" : "sube un archivo"}`
    // Archivos: solo los subidos al sistema o una URL (nunca rutas del servidor)
    if (p.tipo !== "texto" && (!/^(\/uploads\/[^/\\]+|https?:\/\/.+)$/.test(contenido) || contenido.includes("..")))
      return `Mensaje ${i + 1}: archivo inválido`
    const delay = Number(p.delayMs ?? 0)
    if (!Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_MS) return `Mensaje ${i + 1}: espera inválida`
  }
  return null
}

const datosPasos = (pasos: PasoEntrada[]) => pasos.map((p, orden) => ({
  orden,
  tipo: p.tipo,
  contenido: p.contenido.trim(),
  caption: p.tipo === "texto" ? null : (p.caption?.trim() || null),
  delayMs: Math.round(Number(p.delayMs ?? 0)),
}))

const normalizarClaves = (v: any): string[] =>
  Array.isArray(v) ? [...new Set(v.map((c: any) => normalizarCodigo(String(c))).filter(Boolean))] : []

// Crear una respuesta completa
reglasRouter.post("/", ...auth, async (req: any, res) => {
  try {
    const servicio = await prisma.servicio.findUnique({ where: { id: Number(req.body.servicioId) } })
    if (!servicio || servicio.usuarioId !== req.usuario.id) return res.status(404).json({ error: "Servicio no encontrado" })
    const claves = normalizarClaves(req.body.palabrasClave)
    const pasos: PasoEntrada[] = Array.isArray(req.body.pasos) ? req.body.pasos : []
    const error = await validarRegla(servicio, claves, pasos, null)
    if (error) return res.status(400).json({ error })
    const orden = await prisma.respuestaRegla.count({ where: { servicioId: servicio.id } })
    res.json(await prisma.respuestaRegla.create({
      data: {
        servicioId: servicio.id, orden, activo: req.body.activo !== false,
        palabrasClave: claves.join(", "),
        pasos: { create: datosPasos(pasos) },
      },
      include: { pasos: { orderBy: { orden: "asc" } } },
    }))
  } catch { res.status(500).json({ error: "Error al guardar" }) }
})

// Reemplazar una respuesta completa (palabras clave, activo y todos sus pasos)
reglasRouter.put("/:id/completa", ...auth, async (req: any, res) => {
  try {
    const id = Number(req.params.id)
    const regla = await prisma.respuestaRegla.findUnique({ where: { id }, include: { servicio: true } })
    if (!regla || regla.servicio.usuarioId !== req.usuario.id) return res.status(404).json({ error: "Respuesta no encontrada" })
    const claves = normalizarClaves(req.body.palabrasClave)
    const pasos: PasoEntrada[] = Array.isArray(req.body.pasos) ? req.body.pasos : []
    const error = await validarRegla(regla.servicio, claves, pasos, id)
    if (error) return res.status(400).json({ error })
    const [, , actualizada] = await prisma.$transaction([
      prisma.respuestaPaso.deleteMany({ where: { reglaId: id } }),
      prisma.respuestaPaso.createMany({ data: datosPasos(pasos).map(p => ({ ...p, reglaId: id })) }),
      prisma.respuestaRegla.update({
        where: { id },
        data: { palabrasClave: claves.join(", "), activo: req.body.activo !== false },
        include: { pasos: { orderBy: { orden: "asc" } } },
      }),
    ])
    res.json(actualizada)
  } catch { res.status(500).json({ error: "Error al guardar" }) }
})

// Activar / desactivar desde la lista (las palabras y mensajes se editan con /completa)
reglasRouter.put("/:id", ...auth, async (req: any, res) => {
  try {
    const regla = await prisma.respuestaRegla.findUnique({ where: { id: Number(req.params.id) }, include: { servicio: true } })
    if (!regla || regla.servicio.usuarioId !== req.usuario.id) return res.status(404).json({ error: "Respuesta no encontrada" })
    res.json(await prisma.respuestaRegla.update({
      where: { id: regla.id },
      data: { activo: req.body.activo !== false },
      include: { pasos: { orderBy: { orden: "asc" } } },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

reglasRouter.delete("/:id", ...auth, async (req: any, res) => {
  const regla = await prisma.respuestaRegla.findUnique({ where: { id: Number(req.params.id) }, include: { servicio: true } })
  if (!regla || regla.servicio.usuarioId !== req.usuario.id) return res.status(404).json({ error: "Respuesta no encontrada" })
  await prisma.respuestaRegla.delete({ where: { id: regla.id } })
  res.json({ ok: true })
})
