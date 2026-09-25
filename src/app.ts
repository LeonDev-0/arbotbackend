import express from "express"
import cors from "cors"
import { UPLOADS_DIR } from "./config"
import authRouter from "./routes/auth"
import adminRouter from "./routes/admin"
import uploadRouter from "./routes/upload"
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
app.use(cors())
app.use(express.json())
app.use("/uploads", express.static(UPLOADS_DIR))

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
