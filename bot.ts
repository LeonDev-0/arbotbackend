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

export type EstadoWA = "desconectado" | "pausado" | "esperando_qr" | "conectado"

export interface InfoDispositivo {
  id: number
  estado: EstadoWA
  qr: string | null
  telefono: string | null
  sock: WASocket | null
}

const dispositivos = new Map<number, InfoDispositivo>()

export function getDispositivo(id: number) { return dispositivos.get(id) }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/* ═══════════════════════════════════════════
   MAPA DE CÓDIGOS DE PAÍS
═══════════════════════════════════════════ */
const CODIGOS_PAIS: Record<string, { codigo: string; pais: string }> = {
  "1":   { codigo: "1",   pais: "Estados Unidos / Canadá" },
  "52":  { codigo: "52",  pais: "México" },
  "54":  { codigo: "54",  pais: "Argentina" },
  "55":  { codigo: "55",  pais: "Brasil" },
  "56":  { codigo: "56",  pais: "Chile" },
  "57":  { codigo: "57",  pais: "Colombia" },
  "58":  { codigo: "58",  pais: "Venezuela" },
  "591": { codigo: "591", pais: "Bolivia" },
  "593": { codigo: "593", pais: "Ecuador" },
  "595": { codigo: "595", pais: "Paraguay" },
  "598": { codigo: "598", pais: "Uruguay" },
  "51":  { codigo: "51",  pais: "Perú" },
  "502": { codigo: "502", pais: "Guatemala" },
  "503": { codigo: "503", pais: "El Salvador" },
  "504": { codigo: "504", pais: "Honduras" },
  "505": { codigo: "505", pais: "Nicaragua" },
  "506": { codigo: "506", pais: "Costa Rica" },
  "507": { codigo: "507", pais: "Panamá" },
  "509": { codigo: "509", pais: "Haití" },
  "53":  { codigo: "53",  pais: "Cuba" },
  "34":  { codigo: "34",  pais: "España" },
  "44":  { codigo: "44",  pais: "Reino Unido" },
  "33":  { codigo: "33",  pais: "Francia" },
  "49":  { codigo: "49",  pais: "Alemania" },
  "39":  { codigo: "39",  pais: "Italia" },
  "7":   { codigo: "7",   pais: "Rusia" },
  "86":  { codigo: "86",  pais: "China" },
  "91":  { codigo: "91",  pais: "India" },
  "81":  { codigo: "81",  pais: "Japón" },
  "82":  { codigo: "82",  pais: "Corea del Sur" },
}

/* ═══════════════════════════════════════════
   DETECTAR CÓDIGO DE PAÍS DESDE NÚMERO RAW
   Retorna { codigoPais, numeroLocal, pais, numeroCompleto }
   numeroCompleto = "591 64598912"  ← formato canónico de la DB
═══════════════════════════════════════════ */
export function detectarPais(numeroRaw: string): {
  codigoPais: string
  numeroLocal: string
  pais: string
  numeroCompleto: string
} {
  const digitos = numeroRaw
    .replace("@s.whatsapp.net", "")
    .replace("@c.us", "")
    .replace("@lid", "")
    .split(":")[0]
    .replace(/\D/g, "")
    .trim()

  for (const len of [3, 2, 1]) {
    const prefijo = digitos.substring(0, len)
    if (CODIGOS_PAIS[prefijo]) {
      const info = CODIGOS_PAIS[prefijo]
      const numeroLocal = digitos.substring(len)
      const numeroCompleto = `${info.codigo} ${numeroLocal}`
      console.log(`🌍 Número raw: ${digitos} → Prefijo: ${info.codigo} (${info.pais}) → Local: ${numeroLocal} → Completo: ${numeroCompleto}`)
      return { codigoPais: info.codigo, numeroLocal, pais: info.pais, numeroCompleto }
    }
  }

  console.log(`⚠️  No se detectó país para: ${digitos}`)
  return { codigoPais: "", numeroLocal: digitos, pais: "Desconocido", numeroCompleto: digitos }
}

/* ═══════════════════════════════════════════
   CONSTRUIR JID DESDE numeroCompleto guardado en DB
   "591 64598912" → "59164598912@s.whatsapp.net"
═══════════════════════════════════════════ */
export function numeroCompletoAJid(numeroCompleto: string): string {
  const soloDigitos = numeroCompleto.replace(/\D/g, "")
  return `${soloDigitos}@s.whatsapp.net`
}

/* ═══════════════════════════════════════════
   EXTRAER JID REAL DEL MENSAJE
   Si addressingMode === "lid" usa remoteJidAlt
═══════════════════════════════════════════ */
export function extraerJidReal(msg: any): string {
  const esLid = msg.key?.addressingMode === "lid"
  const jidReal = esLid && msg.key?.remoteJidAlt
    ? msg.key.remoteJidAlt
    : msg.key.remoteJid
  console.log(`🔎 addressingMode: ${msg.key?.addressingMode ?? "normal"} | jidReal: ${jidReal}`)
  return jidReal
}

async function generarNombre(usuarioId: number): Promise<string> {
  const total = await prisma.clienteDemo.count({ where: { usuarioId } })
  return `Cliente${total + 1}`
}

async function enviarPaso(sock: WASocket, jid: string, paso: { tipo: string; contenido: string; caption?: string | null }) {
  const src = (c: string) => c.startsWith("http") ? { url: c } : fs.readFileSync(c)
  const ext = paso.contenido.split('.').pop()?.toLowerCase() ?? ''

  if (paso.tipo === "texto") {
    await sock.sendMessage(jid, { text: paso.contenido })
  } else if (paso.tipo === "imagen") {
    await sock.sendMessage(jid, { image: src(paso.contenido), caption: paso.caption ?? "" })
  } else if (paso.tipo === "video") {
    await sock.sendMessage(jid, { video: src(paso.contenido), caption: paso.caption ?? "" })
  } else if (paso.tipo === "documento") {
    const mimeDoc: Record<string, string> = {
      pdf:  "application/pdf",
      doc:  "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls:  "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    await sock.sendMessage(jid, {
      document: src(paso.contenido),
      fileName: paso.caption || `archivo.${ext}`,
      mimetype: mimeDoc[ext] ?? "application/octet-stream",
    })
  } else if (paso.tipo === "audio") {
    const mimeAudio: Record<string, string> = {
      mp3: "audio/mpeg",
      ogg: "audio/ogg; codecs=opus",
      m4a: "audio/mp4",
      wav: "audio/wav",
      aac: "audio/aac",
    }
    await sock.sendMessage(jid, {
      audio: src(paso.contenido),
      mimetype: mimeAudio[ext] ?? "audio/mpeg",
      ptt: false,
    })
  }
}

/* ═══════════════════════════════════════════
   LOG COMPLETO DEL CONTACTO
═══════════════════════════════════════════ */
async function logContacto(msg: any, sock: WASocket, dispositivoId: number) {
  try {
    const jidReal = extraerJidReal(msg)
    const { codigoPais, numeroLocal, pais, numeroCompleto } = detectarPais(jidReal)

    let fotoPerfil = "No disponible"
    try { fotoPerfil = await sock.profilePictureUrl(jidReal, "image") ?? "No disponible" } catch {}

    let estado = "No disponible"
    try { const s = await sock.fetchStatus(jidReal); estado = (s as any)?.status ?? "No disponible" } catch {}

    const timestamp = msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000).toLocaleString("es-BO")
      : "N/A"

    const tipoMensaje = Object.keys(msg.message ?? {}).join(", ") || "desconocido"
    const texto = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? "(sin texto)"

    console.log(`\n${"═".repeat(65)}`)
    console.log(`📩  [Bot ${dispositivoId}] MENSAJE RECIBIDO — ${new Date().toLocaleString("es-BO")}`)
    console.log(`${"═".repeat(65)}`)
    console.log(`📱  remoteJid      : ${msg.key.remoteJid}`)
    console.log(`📱  remoteJidAlt   : ${msg.key.remoteJidAlt ?? "N/A"}`)
    console.log(`🌐  addressingMode : ${msg.key.addressingMode ?? "normal"}`)
    console.log(`✅  JID usado      : ${jidReal}`)
    console.log(`🔢  Número completo: ${numeroCompleto}`)
    console.log(`🔢  Número local   : ${numeroLocal}`)
    console.log(`🌍  País detectado : ${pais} (${codigoPais})`)
    console.log(`👤  Nombre push    : ${msg.pushName ?? "Sin nombre"}`)
    console.log(`💬  Texto          : ${texto}`)
    console.log(`📝  Estado/About   : ${estado}`)
    console.log(`🖼️   Foto perfil    : ${fotoPerfil}`)
    console.log(`🆔  Message ID     : ${msg.key?.id ?? "N/A"}`)
    console.log(`📅  Timestamp      : ${timestamp}`)
    console.log(`📦  Tipo mensaje   : ${tipoMensaje}`)
    console.log(`${"─".repeat(65)}`)
    console.log(`🧩  MSG RAW COMPLETO:`)
    console.log(JSON.stringify(msg, null, 2))
    console.log(`${"═".repeat(65)}\n`)
  } catch (err) {
    console.error(`❌ [Bot ${dispositivoId}] Error en logContacto:`, err)
  }
}

/* ═══════════════════════════════════════════
   MANEJAR MENSAJE
═══════════════════════════════════════════ */
async function manejarMensaje(
  jid: string,
  texto: string,
  dispositivoId: number,
  usuarioId: number,
  sock: WASocket
) {
  const textoLower = texto.trim().toLowerCase()
  // numeroCompleto = "591 64598912" — formato canónico que se guarda en la DB
  const { numeroCompleto } = detectarPais(jid)

  // ── Verificar si es cliente manual registrado → ignorar completamente ────
  // La comparación usa numeroCompleto para coincidir con lo guardado en DB
  const esClienteManual = await prisma.cuentaCliente.findFirst({
    where: { usuarioId, telefono: numeroCompleto },
  })
  if (esClienteManual) {
    console.log(`🚫 [Bot ${dispositivoId}] Cliente manual ignorado: ${numeroCompleto}`)
    return
  }

  // ── DEMO ─────────────────────────────────────────────────────────────────
  if (textoLower === "demo") {
    await manejarDemo(jid, numeroCompleto, dispositivoId, usuarioId, sock)
    return
  }

  // ── Respuestas automáticas ────────────────────────────────────────────────
  const reglas = await prisma.respuestaRegla.findMany({
    where: { dispositivoId, activo: true },
    orderBy: { orden: "asc" },
    include: { pasos: { orderBy: { orden: "asc" } } },
  })

  for (const regla of reglas) {
    const claves = regla.palabrasClave.split(",").map(c => c.trim().toLowerCase()).filter(Boolean)
    if (!claves.some(c => textoLower.includes(c))) continue
    for (const paso of regla.pasos) {
      if (paso.delayMs > 0) await sleep(paso.delayMs)
      try { await enviarPaso(sock, jid, paso) } catch (err) { console.error(`❌ [Bot ${dispositivoId}]:`, err) }
    }
    return
  }
}

/* ═══════════════════════════════════════════
   MANEJAR DEMO
═══════════════════════════════════════════ */
async function manejarDemo(
  jid: string,
  numeroCompleto: string,
  dispositivoId: number,
  usuarioId: number,
  sock: WASocket
) {
  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id: dispositivoId }, include: { servicio: true },
  })
  if (!dispositivo?.servicio) {
    await sock.sendMessage(jid, { text: "⚠️ Este bot no tiene servicio asignado. Contáctanos." })
    return
  }
  const servicio = dispositivo.servicio
  const { pais } = detectarPais(jid)

  const vars = (tpl: string, u: string, c: string) =>
    tpl.replace(/\{usuario\}/g, u).replace(/\{contrasena\}/g, c).replace(/\{servicio\}/g, servicio.nombre)

  // ¿Ya tiene demo de este servicio? (clave: usuarioId + numeroCompleto + servicioId)
  const demoExistente = await prisma.clienteDemo.findUnique({
    where: { usuarioId_telefono_servicioId: { usuarioId, telefono: numeroCompleto, servicioId: servicio.id } },
    include: { cuenta: true },
  })
  if (demoExistente) {
    const texto = servicio.msgDemoYaTiene
      ? vars(servicio.msgDemoYaTiene, demoExistente.cuenta.usuario, demoExistente.cuenta.contrasena)
      : `🎉 ¡Tus credenciales demo de *${servicio.nombre}*!\n\n` +
        `👤 *Usuario:* ${demoExistente.cuenta.usuario}\n` +
        `🔑 *Contraseña:* ${demoExistente.cuenta.contrasena}\n\n` +
        `Para un plan completo contáctanos. 🚀`
    await sock.sendMessage(jid, { text: texto })
    return
  }

  const cuentaDemo = await prisma.cuentaDemo.findFirst({
    where: { usuarioId, servicioId: servicio.id, disponible: true },
  })
  if (!cuentaDemo) {
    const texto = servicio.msgDemoSinStock
      ? vars(servicio.msgDemoSinStock, "", "")
      : `😔 No hay cuentas demo de *${servicio.nombre}* disponibles ahora.\n\nContáctanos directamente.`
    await sock.sendMessage(jid, { text: texto })
    return
  }

  const nombre = await generarNombre(usuarioId)

  await prisma.$transaction([
    prisma.cuentaDemo.update({ where: { id: cuentaDemo.id }, data: { disponible: false } }),
    prisma.clienteDemo.create({
      data: { usuarioId, telefono: numeroCompleto, nombre, cuentaId: cuentaDemo.id, servicioId: servicio.id },
    }),
  ])

  console.log(`ℹ️ [Bot ${dispositivoId}] Demo entregada → ${numeroCompleto} | País: ${pais}`)

  const textoEntrega = servicio.msgDemoEntregada
    ? vars(servicio.msgDemoEntregada, cuentaDemo.usuario, cuentaDemo.contrasena)
    : `🎉 ¡Tu cuenta demo de *${servicio.nombre}*!\n\n` +
      `👤 *Usuario:* ${cuentaDemo.usuario}\n` +
      `🔑 *Contraseña:* ${cuentaDemo.contrasena}\n\n` +
      `⏳ Cuenta de prueba de uso único.\n` +
      `Para un plan completo contáctanos. 🚀`
  await sock.sendMessage(jid, { text: textoEntrega })
}

/* ═══════════════════════════════════════════
   CONECTAR (con sesión persistente)
═══════════════════════════════════════════ */
export async function conectarDispositivo(dispositivoId: number): Promise<void> {
  const existing = dispositivos.get(dispositivoId)
  if (existing?.sock) return

  const entry: InfoDispositivo = existing ?? {
    id: dispositivoId, estado: "esperando_qr", qr: null, telefono: null, sock: null,
  }
  entry.estado = "esperando_qr"
  entry.qr = null
  dispositivos.set(dispositivoId, entry)

  const devDb = await prisma.dispositivo.findUnique({ where: { id: dispositivoId } })
  if (!devDb) return
  const usuarioId = devDb.usuarioId

  const authDir = path.resolve(`auth_${dispositivoId}`)
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    auth: state, printQRInTerminal: false,
    logger: pino({ level: "silent" }), version, connectTimeoutMs: 60000,
    markOnlineOnConnect: false,
  })
  entry.sock = sock
  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const msg of messages) {
      const jidReal = extraerJidReal(msg)
      if (jidReal.endsWith("@g.us")) continue
      if (jidReal === "status@broadcast") continue

      const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ""

      // Si el dueño escribe "demo" en el chat de un contacto → generar demo para ese contacto
      if (msg.key.fromMe) {
        if (texto.trim().toLowerCase() === "demo") {
          const { numeroCompleto } = detectarPais(jidReal)
          try { await manejarDemo(jidReal, numeroCompleto, dispositivoId, usuarioId, sock) }
          catch (err) { console.error(`❌ [Bot ${dispositivoId}] demo manual:`, err) }
        }
        continue
      }

      // ── Mensaje entrante del cliente ─────────────────────────────────────
      if (!texto) continue
      await logContacto(msg, sock, dispositivoId)
      try { await manejarMensaje(jidReal, texto, dispositivoId, usuarioId, sock) }
      catch (err) { console.error(`❌ [Bot ${dispositivoId}]:`, err) }
    }
  })

  sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
    const { qr, connection, lastDisconnect } = update
    const info = dispositivos.get(dispositivoId)!

    if (qr) {
      info.estado = "esperando_qr"; info.qr = qr
      await prisma.dispositivo.update({ where: { id: dispositivoId }, data: { estado: "esperando_qr" } }).catch(() => {})
    }
    if (connection === "open") {
      info.estado = "conectado"; info.qr = null
      info.telefono = sock.user?.id?.split(":")[0] ?? null
      await prisma.dispositivo.update({
        where: { id: dispositivoId },
        data: { estado: "conectado", telefono: info.telefono },
      }).catch(() => {})
      // Ocultar presencia para que el teléfono siga recibiendo notificaciones normalmente
      try { await sock.sendPresenceUpdate("unavailable") } catch {}
      console.log(`✅ [Bot ${dispositivoId}] Conectado — ${info.telefono}`)
    }
    if (connection === "close") {
      const loggedOut =
        (lastDisconnect?.error as any)?.output?.statusCode === DisconnectReason.loggedOut
      info.sock = null; info.telefono = null

      if (loggedOut) {
        const authDir = path.resolve(`auth_${dispositivoId}`)
        if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true })
        info.estado = "desconectado"; info.qr = null
        await prisma.dispositivo.update({
          where: { id: dispositivoId },
          data: { estado: "desconectado", telefono: null },
        }).catch(() => {})
      } else if (info.estado !== "pausado") {
        info.estado = "esperando_qr"
        setTimeout(() => conectarDispositivo(dispositivoId), 3000)
      }
    }
  })
}

/* ═══════════════════════════════════════════
   PAUSAR — cierra socket, conserva auth
═══════════════════════════════════════════ */
export async function pausarDispositivo(dispositivoId: number): Promise<void> {
  const info = dispositivos.get(dispositivoId)
  if (info) {
    info.estado = "pausado"
    if (info.sock) { try { info.sock.end(undefined) } catch {}; info.sock = null }
    info.qr = null; info.telefono = null
  }
  await prisma.dispositivo.update({
    where: { id: dispositivoId },
    data: { estado: "pausado", telefono: null },
  }).catch(() => {})
}

/* ═══════════════════════════════════════════
   DESCONECTAR COMPLETO — borra auth (pide QR de nuevo)
═══════════════════════════════════════════ */
export async function desconectarDispositivo(dispositivoId: number): Promise<void> {
  const info = dispositivos.get(dispositivoId)
  if (info?.sock) { try { await info.sock.logout() } catch {}; info.sock = null }
  const authDir = path.resolve(`auth_${dispositivoId}`)
  if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true })
  if (info) { info.estado = "desconectado"; info.qr = null; info.telefono = null }
  await prisma.dispositivo.update({
    where: { id: dispositivoId },
    data: { estado: "desconectado", telefono: null },
  }).catch(() => {})
}

/* ═══════════════════════════════════════════
   ARRANQUE
═══════════════════════════════════════════ */
export async function iniciarBots(): Promise<void> {
  const devs = await prisma.dispositivo.findMany()
  for (const dev of devs) {
    const authDir = path.resolve(`auth_${dev.id}`)
    const tieneAuth = fs.existsSync(authDir)
    dispositivos.set(dev.id, {
      id: dev.id,
      estado: tieneAuth ? "esperando_qr" : "desconectado",
      qr: null, telefono: null, sock: null,
    })
    if (tieneAuth && dev.estado !== "pausado") {
      conectarDispositivo(dev.id).catch(console.error)
    }
  }
}