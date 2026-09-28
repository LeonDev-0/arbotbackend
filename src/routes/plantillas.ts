import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { auth, esPropio } from "../middleware/auth"
import { archivoPermitido } from "../utils/archivos"

const router = Router()

const TIPOS = ["texto", "imagen", "documento", "audio"]
/* Plantillas con archivo: solo archivos subidos (/uploads/...) o URLs públicas. Texto: sin archivo. */
function validarArchivo(tipo: string, imagenUrl: unknown): { imagenUrl: string | null } | { error: string } {
  if (!TIPOS.includes(tipo)) return { error: "Tipo de plantilla inválido" }
  if (tipo === "texto") return { imagenUrl: null }
  const ref = typeof imagenUrl === "string" ? imagenUrl.trim() : ""
  return archivoPermitido(ref) ? { imagenUrl: ref } : { error: "Sube un archivo o usa una URL pública (http/https)" }
}

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
    const archivo = validarArchivo(tipo ?? "texto", imagenUrl)
    if ("error" in archivo) return res.status(400).json(archivo)
    const pais = paisDefault || null
    const otra = await paisOcupado(req.usuario.id, pais)
    if (otra) return res.status(400).json({ error: `${pais} ya tiene la plantilla "${otra.nombre}"` })
    res.json(await prisma.plantillaRecordatorio.create({
      data: { usuarioId: req.usuario.id, nombre, tipo: tipo ?? "texto", mensaje, imagenUrl: archivo.imagenUrl, paisDefault: pais },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.put("/:id", ...auth, async (req: any, res) => {
  try {
    const id = Number(req.params.id)
    const p = await prisma.plantillaRecordatorio.findUnique({ where: { id } })
    if (!p || p.usuarioId !== req.usuario.id) return res.status(404).json({ error: "Plantilla no encontrada" })
    const { nombre, tipo, mensaje, imagenUrl, paisDefault } = req.body
    const archivo = validarArchivo(tipo ?? p.tipo, imagenUrl)
    if ("error" in archivo) return res.status(400).json(archivo)
    const pais = paisDefault || null
    // Si ya tenía ese país se deja guardar (datos anteriores a esta regla pueden tener duplicados)
    const otra = pais !== p.paisDefault ? await paisOcupado(req.usuario.id, pais, id) : null
    if (otra) return res.status(400).json({ error: `${pais} ya tiene la plantilla "${otra.nombre}"` })
    res.json(await prisma.plantillaRecordatorio.update({
      where: { id },
      data: { nombre, tipo, mensaje, imagenUrl: archivo.imagenUrl, paisDefault: pais },
    }))
  } catch { res.status(500).json({ error: "Error" }) }
})

router.delete("/:id", ...auth, async (req: any, res) => {
  const p = await prisma.plantillaRecordatorio.findUnique({ where: { id: Number(req.params.id) } })
  if (!esPropio(req, p)) return res.status(404).json({ error: "Plantilla no encontrada" })
  await prisma.plantillaRecordatorio.delete({ where: { id: p!.id } })
  res.json({ ok: true })
})

export default router
