import fs from "fs"
import path from "path"
import { UPLOADS_DIR } from "../config"

/* Archivos que el bot envía por WhatsApp (plantillas, respuestas automáticas, imagen tras la demo).
   Solo se permiten archivos subidos al sistema (/uploads/<nombre>) o URLs públicas http(s):
   nunca rutas del servidor (dev.db, .env, sesiones…) ni direcciones internas. */

// Direcciones internas: el servidor no debe descargar de sí mismo ni de la red local
const HOST_INTERNO = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i

function urlPublica(ref: string): URL | null {
  try {
    const u = new URL(ref)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return HOST_INTERNO.test(u.hostname) ? null : u
  } catch { return null }
}

// "/uploads/x.jpg" o "uploads/x.jpg" → ruta real dentro de UPLOADS_DIR (o null si no es un archivo subido)
function rutaSubida(ref: string): string | null {
  const m = ref.trim().match(/^\/?uploads\/([^/\\]+)$/)
  if (!m || m[1] === "." || m[1] === "..") return null
  const ruta = path.join(UPLOADS_DIR, m[1])
  return path.dirname(ruta) === UPLOADS_DIR ? ruta : null
}

/* Para validar al guardar: ¿es una referencia de archivo permitida? */
export function archivoPermitido(ref: string | null | undefined): boolean {
  if (!ref?.trim()) return false
  return !!(urlPublica(ref.trim()) || rutaSubida(ref))
}

/* Para enviar con Baileys: URL pública → { url }, archivo subido → Buffer.
   Lanza un error (que se registra y no se envía) si la referencia no está permitida. */
export function leerArchivo(ref: string): { url: string } | Buffer {
  const u = urlPublica(ref.trim())
  if (u) return { url: u.toString() }
  const ruta = rutaSubida(ref)
  if (!ruta) throw new Error(`Archivo no permitido: "${ref}"`)
  if (!fs.existsSync(ruta)) throw new Error(`El archivo ya no existe: "${ref}"`)
  return fs.readFileSync(ruta)
}
