import { Router } from "express"
import multer from "multer"
import path from "path"
import { UPLOADS_DIR } from "../config"
import { auth } from "../middleware/auth"

const router = Router()

// Solo lo que el bot puede enviar por WhatsApp. Nada de .html/.svg/.js (podrían ejecutar código en el navegador)
export const EXTENSIONES_PERMITIDAS = new Set([
  "jpg", "jpeg", "png", "gif", "webp",            // imágenes
  "mp4", "3gp", "mov", "webm",                    // videos
  "mp3", "ogg", "opus", "m4a", "wav", "aac",      // audios
  "pdf", "doc", "docx", "xls", "xlsx",            // documentos
])

const extension = (nombre: string) => path.extname(nombre).slice(1).toLowerCase()

// "Mi archivo (1).PNG" → "Mi_archivo_1_.png" (sin rutas ni caracteres raros, largo acotado)
function nombreSeguro(original: string): string {
  const ext = extension(original)
  const base = path.basename(original, path.extname(original)).replace(/[^\w\-.]+/g, "_").replace(/^[._]+/, "").slice(0, 60)
  return `${Date.now()}-${base || "archivo"}.${ext}`
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, nombreSeguro(file.originalname)),
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (EXTENSIONES_PERMITIDAS.has(extension(file.originalname))) cb(null, true)
    else cb(new Error("Tipo de archivo no permitido. Usa imagen, video, audio, PDF, Word o Excel."))
  },
})

router.post("/", ...auth, (req, res) => {
  upload.single("archivo")(req, res, (err: any) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "El archivo supera los 50 MB" : err.message
      return res.status(400).json({ error: msg })
    }
    if (!req.file) return res.status(400).json({ error: "No se recibió archivo" })
    res.json({ url: `/uploads/${req.file.filename}` })
  })
})

export default router
