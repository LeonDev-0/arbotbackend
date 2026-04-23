import bcrypt from "bcryptjs"
import { prisma } from "../lib/prisma"
import { iniciarBots } from "../bot"
import { PORT } from "./config"
import app from "./app"

async function seedAdmin() {
  const existe = await prisma.usuario.findUnique({ where: { username: "admin" } })
  if (!existe) {
    const hash = await bcrypt.hash("admin123", 10)
    await prisma.usuario.create({ data: { username: "admin", password: hash, rol: "admin", activo: true } })
    console.log("👤 Admin creado — usuario: admin / contraseña: admin123")
  }
}

iniciarBots()

app.listen(PORT, async () => {
  await seedAdmin()
  console.log(`🚀 http://localhost:${PORT}`)
})
