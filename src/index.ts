import bcrypt from "bcryptjs"
import crypto from "crypto"
import { prisma } from "../lib/prisma"
import { iniciarBots } from "../bot"
import { iniciarRecordatorios } from "./recordatorios"
import { PORT } from "./config"
import app from "./app"

/* Primer arranque (sin ningún admin): crea "admin" con ADMIN_PASSWORD del .env
   o, si no está, con una contraseña aleatoria que se muestra una sola vez. */
async function seedAdmin() {
  if (await prisma.usuario.count({ where: { rol: "admin" } })) return
  const password = process.env.ADMIN_PASSWORD?.trim() || crypto.randomBytes(9).toString("base64url")
  await prisma.usuario.create({ data: { username: "admin", password: await bcrypt.hash(password, 10), rol: "admin", activo: true } })
  console.log(process.env.ADMIN_PASSWORD
    ? "👤 Admin creado — usuario: admin / contraseña: la de ADMIN_PASSWORD"
    : `👤 Admin creado — usuario: admin / contraseña: ${password}  ← anótala, no se vuelve a mostrar`)
}

iniciarBots()
iniciarRecordatorios()

app.listen(PORT, async () => {
  await seedAdmin()
  console.log(`🚀 http://localhost:${PORT}`)
})
