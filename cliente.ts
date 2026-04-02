import express from "express"
import cors from "cors"
import { prisma } from "./lib/prisma"
import {
  iniciarWhatsApp,
  desconectarWhatsApp,
  estadoWA,
  qrActual,
  telefonoConectado,
} from "./bot"

const app = express()
app.use(cors())
app.use(express.json())

iniciarWhatsApp()

/* =========================
   WHATSAPP
========================= */

app.get("/whatsapp/estado", (_req, res) => {
  res.json({ estado: estadoWA, qr: qrActual, telefono: telefonoConectado })
})

app.post("/whatsapp/conectar", async (_req, res) => {
  try { await iniciarWhatsApp(); res.json({ ok: true }) }
  catch { res.status(500).json({ error: "No se pudo iniciar WhatsApp" }) }
})

app.post("/whatsapp/desconectar", async (_req, res) => {
  try { await desconectarWhatsApp(); res.json({ ok: true }) }
  catch { res.status(500).json({ error: "Error al desconectar" }) }
})

/* =========================
   CLIENTES
========================= */

// Listar todos con sus cuentas
app.get("/clientes", async (_req, res) => {
  const clientes = await prisma.cliente.findMany({
    orderBy: { id: "desc" },
    include: { cuentas: true },
  })
  res.json(clientes)
})

// Crear cliente
app.post("/clientes", async (req, res) => {
  try {
    const { telefono, cuentas } = req.body
    if (!telefono) return res.status(400).json({ error: "telefono es requerido" })

    const jid = telefono.replace(/\D/g, "") + "@s.whatsapp.net"

    const existe = await prisma.cliente.findUnique({ where: { telefono: jid } })
    if (existe) return res.status(400).json({ error: "Este número ya está registrado" })

    const cliente = await prisma.cliente.create({
      data: {
        telefono: jid,
        cuentas: {
          create: (cuentas ?? []).slice(0, 3).map((c: any) => ({
            usuario: c.usuario,
            contrasena: c.contrasena,
          })),
        },
      },
      include: { cuentas: true },
    })
    res.json(cliente)
  } catch (e) {
    res.status(500).json({ error: "Error al crear cliente" })
  }
})

// Actualizar teléfono del cliente
app.put("/clientes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { telefono } = req.body
    const jid = telefono.replace(/\D/g, "") + "@s.whatsapp.net"
    const cliente = await prisma.cliente.update({
      where: { id },
      data: { telefono: jid },
      include: { cuentas: true },
    })
    res.json(cliente)
  } catch { res.status(500).json({ error: "Error al actualizar" }) }
})

// Eliminar cliente (y sus cuentas en cascada)
app.delete("/clientes/:id", async (req, res) => {
  const id = Number(req.params.id)
  await prisma.cliente.delete({ where: { id } })
  res.json({ message: "Cliente eliminado" })
})

/* =========================
   CUENTAS DE CLIENTES
========================= */

// Agregar cuenta a cliente (máx 3)
app.post("/clientes/:id/cuentas", async (req, res) => {
  try {
    const clienteId = Number(req.params.id)
    const { usuario, contrasena } = req.body
    if (!usuario || !contrasena) return res.status(400).json({ error: "usuario y contrasena requeridos" })

    const total = await prisma.cuentaCliente.count({ where: { clienteId } })
    if (total >= 3) return res.status(400).json({ error: "El cliente ya tiene el máximo de 3 cuentas" })

    const cuenta = await prisma.cuentaCliente.create({
      data: { clienteId, usuario, contrasena },
    })
    res.json(cuenta)
  } catch { res.status(500).json({ error: "Error al agregar cuenta" }) }
})

// Editar cuenta de cliente
app.put("/cuentas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { usuario, contrasena } = req.body
    const cuenta = await prisma.cuentaCliente.update({
      where: { id },
      data: { usuario, contrasena },
    })
    res.json(cuenta)
  } catch { res.status(500).json({ error: "Error al actualizar cuenta" }) }
})

// Eliminar cuenta de cliente
app.delete("/cuentas/:id", async (req, res) => {
  const id = Number(req.params.id)
  await prisma.cuentaCliente.delete({ where: { id } })
  res.json({ message: "Cuenta eliminada" })
})

/* =========================
   DEMOS
========================= */

app.get("/demos", async (_req, res) => {
  const cuentas = await prisma.cuentaDemo.findMany({ orderBy: { id: "desc" } })
  res.json(cuentas)
})

app.post("/demos", async (req, res) => {
  try {
    const { usuario, contrasena } = req.body
    if (!usuario || !contrasena) return res.status(400).json({ error: "usuario y contrasena requeridos" })
    const cuenta = await prisma.cuentaDemo.create({ data: { usuario, contrasena, disponible: true } })
    res.json(cuenta)
  } catch { res.status(500).json({ error: "Error al crear la cuenta" }) }
})

app.delete("/demos/:id", async (req, res) => {
  await prisma.cuentaDemo.delete({ where: { id: Number(req.params.id) } })
  res.json({ message: "Cuenta eliminada" })
})

app.patch("/demos/:id/resetear", async (req, res) => {
  const cuenta = await prisma.cuentaDemo.update({
    where: { id: Number(req.params.id) },
    data: { disponible: true },
  })
  res.json(cuenta)
})

/* =========================
   SESIONES DEMO
========================= */

app.get("/sesiones", async (_req, res) => {
  const sesiones = await prisma.sesionDemo.findMany({ orderBy: { entregadoEn: "desc" } })
  res.json(sesiones)
})

app.delete("/sesiones/:id", async (req, res) => {
  await prisma.sesionDemo.delete({ where: { id: Number(req.params.id) } })
  res.json({ message: "Sesión eliminada." })
})

/* =========================
   SERVIDOR
========================= */

app.listen(3001, () => console.log("🚀 Servidor en http://localhost:3001"))