import express from "express"
import cors from "cors"
import path from "path"
import { UPLOADS_DIR } from "./config"
import authRouter from "./routes/auth"
import adminRouter from "./routes/admin"
import uploadRouter, { EXTENSIONES_PERMITIDAS } from "./routes/upload"
import serviciosRouter from "./routes/servicios"
import dispositivosRouter from "./routes/dispositivos"
import { reglasRouter } from "./routes/reglas"
import plantillasRouter from "./routes/plantillas"
import clientesRouter from "./routes/clientes"
import { clientesDemoRouter } from "./routes/demos"
import rutasRecordatorioRouter from "./routes/rutasRecordatorio"
import { buscarUsuarioIPTV } from "./iptvservice"
import { auth } from "./middleware/auth"

const app = express()
// Detrás de nginx (Docker): tomar la IP real del cliente (X-Forwarded-For) solo si viene de una red interna.
// Sin esto, todas las peticiones parecerían de nginx y el límite de intentos bloquearía a todos a la vez.
app.set("trust proxy", "loopback, linklocal, uniquelocal")
// El frontend llega por el mismo dominio (nginx / proxy de Vite): no hace falta CORS.
// Si algún día se sirve desde otro dominio, listarlo en CORS_ORIGINS (separados por coma).
const origenesCors = (process.env.CORS_ORIGINS ?? "").split(",").map(o => o.trim()).filter(Boolean)
if (origenesCors.length) app.use(cors({ origin: origenesCors }))
app.use(express.json({ limit: "5mb" })) // la importación de Excel puede traer miles de filas
// Archivos subidos: solo tipos permitidos y sin posibilidad de ejecutarse en el navegador
const MEDIA_EN_LINEA = /\.(jpe?g|png|gif|webp|mp4|3gp|mov|webm|mp3|ogg|opus|m4a|wav|aac)$/i
app.use("/uploads", (req, res, next) => {
  const ext = path.extname(req.path).slice(1).toLowerCase()
  if (!EXTENSIONES_PERMITIDAS.has(ext)) return res.status(404).end()
  next()
}, express.static(UPLOADS_DIR, {
  dotfiles: "deny",
  setHeaders: (res, ruta) => {
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
    if (!MEDIA_EN_LINEA.test(ruta)) res.setHeader("Content-Disposition", "attachment")
  },
}))

app.use("/auth", authRouter)
app.use("/admin/usuarios", adminRouter)
app.use("/upload", uploadRouter)
app.use("/servicios", serviciosRouter)
app.use("/dispositivos", dispositivosRouter)
app.use("/reglas", reglasRouter)
app.use("/plantillas", plantillasRouter)
app.use("/cuentas-clientes", clientesRouter)
app.use("/clientes-demo", clientesDemoRouter)
app.use("/rutas-recordatorio", rutasRecordatorioRouter)

// Consulta directa de una cuenta en el panel IPTV
app.get("/iptv/cuenta/:usuario", ...auth, async (req: any, res) => {
  try {
    const datos = await buscarUsuarioIPTV(req.params.usuario, req.usuario.id)
    res.json(datos)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default app
