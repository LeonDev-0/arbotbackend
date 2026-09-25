import "dotenv/config"
import path from "path"
import fs from "fs"

// Sin clave por defecto: con una clave conocida cualquiera podría fabricar sesiones válidas
const secreto = process.env.JWT_SECRET?.trim() ?? ""
if (secreto.length < 32) {
  throw new Error(
    "JWT_SECRET no está configurado o es muy corto (mínimo 32 caracteres). " +
    "Agrégalo al .env, por ejemplo con: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
  )
}
export const JWT_SECRET = secreto
export const PORT = Number(process.env.PORT ?? 3001)
export const UPLOADS_DIR = path.resolve("uploads")
// Sesiones de WhatsApp (una carpeta auth_<id> por dispositivo). En Docker es un volumen.
export const SESIONES_DIR = path.resolve(process.env.SESIONES_DIR ?? "sesiones")

for (const dir of [UPLOADS_DIR, SESIONES_DIR]) if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
