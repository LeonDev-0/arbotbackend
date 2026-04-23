import path from "path"
import fs from "fs"

export const JWT_SECRET = process.env.JWT_SECRET ?? "demo-bot-secret-2024"
export const PORT = Number(process.env.PORT ?? 3001)
export const UPLOADS_DIR = path.resolve("uploads")

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR)
