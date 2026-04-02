import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
  ConnectionState,
} from "@whiskeysockets/baileys"
import pino from "pino"
import { prisma } from "./lib/prisma"
import fs from "fs"
import path from "path"

let sock: WASocket | null = null

export type EstadoWA = "desconectado" | "esperando_qr" | "conectado"
export let estadoWA: EstadoWA = "desconectado"
export let qrActual: string | null = null
export let telefonoConectado: string | null = null

export function getSock(): WASocket | null {
  return sock
}

export async function desconectarWhatsApp(): Promise<void> {
  if (sock) {
    try { await sock.logout() } catch {}
    sock = null
  }
  estadoWA = "desconectado"
  qrActual = null
  telefonoConectado = null
  const authDir = path.resolve("auth")
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true })
  }
}

/* =========================
   HELPERS
========================= */

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Extrae el JID real desde remoteJidAlt (ej: 59164598912@s.whatsapp.net)
 * y devuelve solo el número (ej: 59164598912@s.whatsapp.net)
 * Si no existe remoteJidAlt, intenta con remoteJid normal.
 */
function extraerJID(msg: any): string | null {
  const raw: string =
    msg.key?.remoteJidAlt ||
    msg.key?.remoteJid ||
    ""

  if (!raw) return null
  if (raw.endsWith("@g.us")) return null

  // Extraer solo los dígitos antes del @ y reconstruir JID limpio
  const numero = raw.split("@")[0].split(":")[0].replace(/\D/g, "")
  if (!numero) return null
  return `${numero}@s.whatsapp.net`
}

/* =========================
   LÓGICA DEL BOT
========================= */

async function manejarMensaje(jid: string, texto: string) {
  if (!sock) return

  // ── 1. ¿Es un cliente registrado en la BD? → ignorar completamente ──────
  const esCliente = await prisma.cliente.findUnique({ where: { telefono: jid } })
  if (esCliente) return

  // ── 2. ¿Ya recibió la bienvenida antes? ─────────────────────────────────
  const yaBienvenido = await prisma.numeroBienvenido.findUnique({
    where: { telefono: jid },
  })

  if (!yaBienvenido) {
    // Primera vez → registrar y enviar bienvenida (una sola vez)
    await prisma.numeroBienvenido.create({ data: { telefono: jid } })
    await enviarFlujoBienvenida(jid)
    return
  }

  // ── 3. Ya recibió bienvenida → solo responder a "demo" ──────────────────
  if (texto.trim().toLowerCase() !== "demo") return
  await entregarDemo(jid)
}

/* ── Flujo de bienvenida (3 mensajes con delays) ── */
async function enviarFlujoBienvenida(jid: string) {
  if (!sock) return

  await sock.sendMessage(jid, {
    text:
      `¡Hola! 👋 *Bienvenido/a a VELTIX* 📺🔥\n\n` +
      `Con VELTIX tienes *todo tu entretenimiento en un solo lugar*:\n\n` +
      `🎬 Películas y series actualizadas constantemente\n` +
      `📺 Canales en vivo en excelente calidad\n` +
      `⚽ Deportes y fútbol en vivo sin interrupciones\n` +
      `⚡ Servicio rápido, estable y confiable\n\n` +
      `📱 *Compatible con dispositivos Android:*\n` +
      `✔ Android TV\n` +
      `✔ TV Box\n` +
      `✔ Celular\n` +
      `✔ Tablet\n\n` +
      `🌐 *Requisitos recomendados:*\n` +
      `✔ Internet WiFi estable\n` +
      `✔ Mínimo 10 MB\n\n` +
      `🎁 *También puedes solicitar una PRUEBA GRATIS* para comprobar la calidad, estabilidad y contenido antes de contratar 😉\n\n` +
      `👇 *Ahora te comparto la imagen con los planes y precios disponibles*\n\n` +
      `Si deseas activar la prueba o tienes alguna duda, *estoy aquí para ayudarte* 🚀`,
  })

  await sleep(3000)

  const preciosPath = path.resolve("recursos", "precios.jpeg")
  if (fs.existsSync(preciosPath)) {
    const imageBuffer = fs.readFileSync(preciosPath)
    await sock.sendMessage(jid, { image: imageBuffer, caption: "" })
  } else {
    console.warn("⚠️  No se encontró recursos/precios.png — se omite la imagen.")
  }

  await sleep(3000)

  await sock.sendMessage(jid, {
    text:
      `🚀 *PRUEBA VELTIX EN TU DISPOSITIVO ANDROID*\n\n` +
      `📺 *Versión para TV / TV Box Android*\n` +
      `VELTIX TV (v0.1.32)\n` +
      `🔢 Código Downloader: *6728565*\n` +
      `⬇️ Descarga directa:\n` +
      `👉 https://gxapps.es/VeltixTV.apk\n\n` +
      `📱 *Versión para celulares y tablets*\n` +
      `VELTIX Móvil (v0.1.25)\n` +
      `⬇️ Descarga directa:\n` +
      `👉 https://gxapps.es/VeltixMob.apk\n\n` +
      `🎁 *Prueba GRATIS de 2 horas*\n` +
      `✅ Revisa canales\n` +
      `✅ Comprueba estabilidad\n` +
      `⚠️ Es importante realizar la prueba para verificar el correcto funcionamiento en tu dispositivo\n\n` +
      `⚽ Mira la programación de fútbol sin interrupciones\n\n` +
      `🔑 Si ya descargaste e instalaste la aplicación, escribe la palabra clave *DEMO* en este chat para obtener tu usuario y contraseña de prueba.`,
  })
}

/* ── Entregar credenciales demo ── */
async function entregarDemo(jid: string) {
  if (!sock) return

  const sesionExistente = await prisma.sesionDemo.findUnique({
    where: { telefono: jid },
  })

  if (sesionExistente) {
    const cuentaAnterior = await prisma.cuentaDemo.findUnique({
      where: { id: sesionExistente.cuentaId },
    })
    if (cuentaAnterior) {
      await sock.sendMessage(jid, {
        text:
          `👤 *Usuario:* ${cuentaAnterior.usuario}
` +
          `🔑 *Contraseña:* ${cuentaAnterior.contrasena}

` +
          `🎁 Tu prueba gratuita es por *2 horas*.

` +
          `🔓 Si deseas continuar con el servicio, puedes activar el plan de *1 mes* por solo *$5.600*.

` +
          `💳 Alias: *sandro.veltix* 
`+
          `🔹 Nombre: *Sandro Leon*

` +
          `📩 Envía el comprobante por este chat para activar tu cuenta.

` +
          `🔞 Clave para contenido adultos: *37632*`,
      })
    }
    return
  }

  const cuenta = await prisma.cuentaDemo.findFirst({ where: { disponible: true } })

  if (!cuenta) {
    await sock.sendMessage(jid, {
      text:
        `😔 Lo sentimos, no tenemos cuentas demo disponibles en este momento.\n\n` +
        `Escríbenos más tarde o contáctanos directamente. ¡Gracias!`,
    })
    return
  }

  await prisma.$transaction([
    prisma.cuentaDemo.update({
      where: { id: cuenta.id },
      data: { disponible: false },
    }),
    prisma.sesionDemo.create({
      data: { telefono: jid, cuentaId: cuenta.id },
    }),
  ])

  // Mensaje simulando generación
  await sock.sendMessage(jid, {
    text: `⏳ Generando cuenta de prueba...`,
  })

  await sleep(3000)

  await sock.sendMessage(jid, {
    text:
      `👤 *Usuario:* ${cuenta.usuario}
` +
      `🔑 *Contraseña:* ${cuenta.contrasena}

` +
      `🎁 Tu prueba gratuita es por *2 horas*.

` +
      `🔓 Si deseas continuar con el servicio, puedes activar el plan de *1 mes* por solo *$5.600*.

` +
      `💳 Pago por *Mercado Pago* 🔹 Alias: *sandro.veltix*

` +
      `📩 Envía el comprobante por este chat para activar tu cuenta.

` +
      `🔞 Clave para contenido adultos: *37632*`,
  })
}

/* =========================
   CONEXIÓN WHATSAPP
========================= */

export async function iniciarWhatsApp(): Promise<void> {
  estadoWA = "esperando_qr"
  qrActual = null

  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    version,
    connectTimeoutMs: 60000,
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const msg of messages) {
      if (msg.key.fromMe) continue
      const jid = extraerJID(msg)
      if (!jid) continue
      const texto: string = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ""
      ).trim()
      if (!texto) continue
      console.log(`📩 JID: ${jid} | texto: ${texto}`)
      try { await manejarMensaje(jid, texto) }
      catch (err) { console.error("❌ Error al manejar mensaje:", err) }
    }
  })

  sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
    const { qr, connection, lastDisconnect } = update

    if (qr) {
      estadoWA = "esperando_qr"
      qrActual = qr
    }

    if (connection === "open") {
      estadoWA = "conectado"
      qrActual = null
      try {
        const info = sock?.user
        telefonoConectado = info?.id?.split(":")[0] ?? info?.id ?? null
      } catch {}
      console.log(`✅ WhatsApp conectado — ${telefonoConectado ?? "número desconocido"}`)
    }

    if (connection === "close") {
      sock = null
      telefonoConectado = null
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        estadoWA = "esperando_qr"
        console.log("🔄 Reconectando...")
        setTimeout(() => iniciarWhatsApp(), 3000)
      } else {
        estadoWA = "desconectado"
        qrActual = null
        console.log("❌ Sesión cerrada.")
      }
    }
  })
}