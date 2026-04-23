import express from "express"
import cors from "cors"
import { UPLOADS_DIR } from "./config"
import authRouter from "./routes/auth"
import adminRouter from "./routes/admin"
import uploadRouter from "./routes/upload"
import serviciosRouter from "./routes/servicios"
import dispositivosRouter from "./routes/dispositivos"
import { reglasRouter, pasosRouter } from "./routes/reglas"
import plantillasRouter from "./routes/plantillas"
import clientesRouter from "./routes/clientes"
import { demosRouter, clientesDemoRouter } from "./routes/demos"

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
app.use("/pasos", pasosRouter)
app.use("/plantillas", plantillasRouter)
app.use("/cuentas-clientes", clientesRouter)
app.use("/demos", demosRouter)
app.use("/clientes-demo", clientesDemoRouter)

export default app
