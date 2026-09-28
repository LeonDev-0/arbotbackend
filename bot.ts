
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
import { crearUsuarioIPTV, buscarUsuarioIPTV } from "./src/iptvservice"
import { resolverPlantilla } from "./src/routes/clientes"
import { normalizarCodigo, clavesRegla } from "./src/utils/codigosDemo"
import { SESIONES_DIR } from "./src/config"
import { leerArchivo } from "./src/utils/archivos"

export type EstadoWA = "desconectado" | "pausado" | "esperando_qr" | "conectado"

export interface InfoDispositivo {
  id: number
  estado: EstadoWA
  qr: string | null
  telefono: string | null
  sock: WASocket | null
}

const dispositivos = new Map<number, InfoDispositivo>()
const qrMostrado = new Map<number, boolean>()

// ── Estado del flujo de demo por cliente ─────────────────────────────────────
// Clave: jid del cliente (ej: "59164598912@s.whatsapp.net")
const userStates     = new Map<string, string>() // estado actual
const procesoCritico = new Set<string>()         // bloqueados durante creación


export function getDispositivo(id: number) { return dispositivos.get(id) }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const MSG_ADULTOS =
  `🎬 *¡Tu prueba gratis está a un paso!*\n\n` +
  `🔞 ¿Deseas incluir canales para adultos (+18)?\n\n` +
  `1️⃣ Sí, incluir contenido adulto\n` +
  `2️⃣ No, sin contenido adulto\n\n` +
  `0️⃣ Cancelar`

// Servicio asignado al número (dispositivo) que recibe el mensaje o donde el dueño escribe el comando
async function servicioDelDispositivo(dispositivoId: number) {
  const dev = await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, include: { servicio: true } })
  return dev?.servicio ?? null
}

// Duración legible del plan de demo: "DEMO 3 HORAS" → "3 horas", "DEMO 1 HORA" → "1 hora"
function duracionDemo(plan: string): string {
  const n = Number(plan.match(/(\d+)\s*HORA/i)?.[1])
  if (!n) return ""
  return n === 1 ? "1 hora" : `${n} horas`
}

// Muestra solo la descripción del plan, sin precio ni costo de créditos
// Ej: "6 MESES (+1 MES GRATIS) - 2 DISP (190 Bs) - Costo: 4.5 Creditos"
//   → "6 MESES (+1 MES GRATIS) - 2 DISP"
function fmtPlan(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.replace(/\s*\(\d[^)]*\).*$/, "").trim()
}

function fmtCorta(d: Date): string {
  const m = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]
  return `${String(d.getUTCDate()).padStart(2,"0")}/${m[d.getUTCMonth()]}/${d.getUTCFullYear()}`
}

// Sesión de WhatsApp de cada dispositivo: sesiones/auth_<id> (en Docker, dentro del volumen de sesiones)
const carpetaSesion = (dispositivoId: number) => path.join(SESIONES_DIR, `auth_${dispositivoId}`)
// Hay sesión si tiene credenciales guardadas (una carpeta vacía no cuenta)
const tieneSesion = (dispositivoId: number) => fs.existsSync(path.join(carpetaSesion(dispositivoId), "creds.json"))
const borrarSesion = (dispositivoId: number) => fs.rmSync(carpetaSesion(dispositivoId), { recursive: true, force: true })

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

export const PAISES_BOT = Object.values(CODIGOS_PAIS).map(c => c.pais)

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
  const src = leerArchivo // solo archivos subidos (/uploads/...) o URLs públicas
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
   HELPERS DEL FLUJO DEMO
═══════════════════════════════════════════ */
function limpiarEstadoDemo(key: string): void {
  userStates.delete(key)
}

/* Crea la demo en el panel IPTV, la registra y envía las credenciales al cliente.
   procesoCritico se marca antes de cualquier await: evita crear dos demos si el
   cliente responde dos veces seguidas. */
async function handleDemoCreacion(
  jid: string,
  key: string,
  incluirAdultos: boolean,
  dispositivoId: number,
  usuarioId: number,
  sock: WASocket
): Promise<void> {
  if (procesoCritico.has(key)) return
  procesoCritico.add(key)
  try {
    const servicio = await servicioDelDispositivo(dispositivoId)
    if (!servicio?.planDemo) throw new Error("El servicio no tiene plan de demo configurado")
    await sock.sendMessage(jid, { text: `⏳ *CREANDO TU PRUEBA GRATIS DE ${servicio.nombre.toUpperCase()}...*\n\nPor favor espera un momento.` })
    const { numeroCompleto } = detectarPais(jid)

    const panelData = await crearUsuarioIPTV(servicio.planDemo, incluirAdultos, usuarioId)

    const cuentaDemo = await prisma.cuentaDemo.create({
      data: { usuarioId, servicioId: servicio.id, usuario: panelData.usuario, contrasena: panelData.password },
    })
    // Si ya tenía demo (demo forzada con "22"), se reemplaza y se borra la cuenta anterior
    const previa = await prisma.clienteDemo.findUnique({
      where: { usuarioId_telefono_servicioId: { usuarioId, telefono: numeroCompleto, servicioId: servicio.id } },
    })
    if (previa) {
      await prisma.clienteDemo.update({ where: { id: previa.id }, data: { cuentaId: cuentaDemo.id, entregadoEn: new Date() } })
      await prisma.cuentaDemo.delete({ where: { id: previa.cuentaId } })
    } else {
      await prisma.clienteDemo.create({
        data: { usuarioId, telefono: numeroCompleto, nombre: await generarNombre(usuarioId), cuentaId: cuentaDemo.id, servicioId: servicio.id },
      })
    }

    limpiarEstadoDemo(key)
    console.log(`✅ [Bot ${dispositivoId}] Demo creada → ${numeroCompleto} | ${panelData.usuario}`)

    const duracion = duracionDemo(servicio.planDemo)
    const vars = (tpl: string) =>
      tpl.replace(/\{usuario\}/g, panelData.usuario)
         .replace(/\{contrasena\}/g, panelData.password)
         .replace(/\{servicio\}/g, servicio.nombre)
         .replace(/\{duracion\}/g, duracion)

    const msg = servicio?.msgDemoEntregada
      ? vars(servicio.msgDemoEntregada)
      : `✅ *¡TU PRUEBA GRATIS ESTÁ LISTA!*\n\n` +
        `┌───────────────\n` +
        `👤 Usuario: *${panelData.usuario}*\n` +
        `🔐 Contraseña: *${panelData.password}*\n` +
        `└───────────────\n\n` +
        (duracion
          ? `⏱️ Tu prueba es de *${duracion}* y comienza cuando ingreses por primera vez.\n\n`
          : `⏱️ La prueba comienza cuando ingreses por primera vez.\n\n`) +
        `📲 Si necesitas ayuda para instalar, escríbenos.`

    await sock.sendMessage(jid, { text: msg })
    // La demo ya se entregó: si la imagen falla solo se registra (no avisar "no se pudo crear")
    if (servicio.imagenDespuesDemo) {
      try {
        await sock.sendMessage(jid, { image: leerArchivo(servicio.imagenDespuesDemo) as any, caption: servicio.captionImagenDespuesDemo ?? "" })
      } catch (e: any) {
        console.error(`❌ [Bot ${dispositivoId}] Imagen después de la demo:`, e.message)
      }
    }
  } catch (e: any) {
    limpiarEstadoDemo(key)
    console.error(`❌ [Bot ${dispositivoId}] Error demo Puppeteer:`, e.message)
    await sock.sendMessage(jid, {
      text: `⚠️ *NO SE PUDO CREAR LA PRUEBA GRATIS*\n\n` +
            `Ocurrió un problema temporal.\n\n` +
            `⏳ Por favor intenta más tarde o contáctanos directamente.`,
    })
  } finally {
    procesoCritico.delete(key)
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
  const { numeroCompleto } = detectarPais(jid)
  const stateKey = `${usuarioId}:${jid}`

  // 1. En proceso crítico (Puppeteer creando cuenta) → ignorar todo
  if (procesoCritico.has(stateKey)) return

  // 2. Estado: esperando respuesta sobre contenido adulto
  if (userStates.get(stateKey) === "demo_esperando_adultos") {
    if (textoLower === "0" || textoLower === "cancelar") {
      limpiarEstadoDemo(stateKey)
      await sock.sendMessage(jid, { text: "❌ Proceso cancelado." })
      return
    }
    if (textoLower === "1" || textoLower === "si" || textoLower === "sí") {
      await handleDemoCreacion(jid, stateKey, true, dispositivoId, usuarioId, sock)
      return
    }
    if (textoLower === "2" || textoLower === "no") {
      await handleDemoCreacion(jid, stateKey, false, dispositivoId, usuarioId, sock)
      return
    }
    await sock.sendMessage(jid, { text: MSG_ADULTOS })
    return
  }

  const servicio = await servicioDelDispositivo(dispositivoId)
  if (!servicio) return

  // 3. Respuestas automáticas por reglas del servicio (aplica a todos, incluidos clientes con cuenta)
  if (await ejecutarRegla(servicio.id, textoLower, jid, dispositivoId, sock)) return

  // 4. Ignorar clientes con cuenta registrada (no participan en flujo demo)
  const esCliente = await prisma.cuentaCliente.findFirst({
    where: { usuarioId, telefono: numeroCompleto },
  })
  if (esCliente) return

  // 5. Código de demo del servicio → iniciar flujo
  if (textoLower === normalizarCodigo(servicio.codigoDemo)) {
    await manejarDemo(jid, numeroCompleto, stateKey, dispositivoId, usuarioId, sock)
  }
}

/* Ejecuta la respuesta automática cuya palabra clave coincide exactamente con el texto.
   Devuelve true si encontró una. */
async function ejecutarRegla(servicioId: number, textoLower: string, jid: string, dispositivoId: number, sock: WASocket): Promise<boolean> {
  const reglas = await prisma.respuestaRegla.findMany({
    where: { servicioId, activo: true },
    orderBy: { orden: "asc" },
    include: { pasos: { orderBy: { orden: "asc" } } },
  })
  const regla = reglas.find(r => clavesRegla(r.palabrasClave).includes(textoLower))
  if (!regla) return false
  for (const paso of regla.pasos) {
    if (paso.delayMs > 0) await sleep(paso.delayMs)
    try { await enviarPaso(sock, jid, paso) } catch (err) { console.error(`❌ [Bot ${dispositivoId}]:`, err) }
  }
  return true
}

/* ═══════════════════════════════════════════
   MANEJAR DEMO
═══════════════════════════════════════════ */
async function manejarDemo(
  jid: string,
  numeroCompleto: string,
  stateKey: string,
  dispositivoId: number,
  usuarioId: number,
  sock: WASocket,
  forzar = false,
  adultos?: boolean, // códigos del dueño: con/sin adultos directo, sin preguntar
) {
  const servicio = await servicioDelDispositivo(dispositivoId)
  if (!servicio) {
    if (!forzar) await sock.sendMessage(jid, { text: "⚠️ Este bot no tiene servicio asignado. Contáctanos." })
    else console.warn(`⚠️ [Bot ${dispositivoId}] 22: el número no tiene servicio asignado`)
    return
  }

  // Demo forzada por el dueño ("22" en el chat): ignora "demos desactivadas" y si ya tenía demo
  if (!forzar) {
    // Demos desactivadas o sin plan configurado
    if (!servicio.demosActivo || !servicio.planDemo) {
      const texto = servicio.msgDemoDesactivado?.trim()
        || `⛔ Las demos de *${servicio.nombre}* no están disponibles en este momento.\n\nContáctanos para más información.`
      await sock.sendMessage(jid, { text: texto })
      return
    }

    // ¿Ya tiene demo de este servicio? → mostrar sus credenciales
    const demoExistente = await prisma.clienteDemo.findUnique({
      where: { usuarioId_telefono_servicioId: { usuarioId, telefono: numeroCompleto, servicioId: servicio.id } },
      include: { cuenta: true },
    })
    if (demoExistente) {
      const { usuario, contrasena } = demoExistente.cuenta
      const texto = servicio.msgDemoYaTiene
        ? servicio.msgDemoYaTiene
            .replace(/\{usuario\}/g, usuario).replace(/\{contrasena\}/g, contrasena).replace(/\{servicio\}/g, servicio.nombre)
            .replace(/\{duracion\}/g, duracionDemo(servicio.planDemo))
        : `🎉 ¡Tus credenciales demo de *${servicio.nombre}*!\n\n` +
          `👤 *Usuario:* ${usuario}\n` +
          `🔑 *Contraseña:* ${contrasena}\n\n` +
          `Para un plan completo contáctanos. 🚀`
      await sock.sendMessage(jid, { text: texto })
      return
    }
  } else if (!servicio.planDemo) {
    console.warn(`⚠️ [Bot ${dispositivoId}] 22: el servicio "${servicio.nombre}" no tiene plan de demo`)
    return
  }

  if (adultos === undefined && servicio.adultos === "preguntar") {
    userStates.set(stateKey, "demo_esperando_adultos")
    await sock.sendMessage(jid, { text: MSG_ADULTOS })
    return
  }
  await handleDemoCreacion(jid, stateKey, adultos ?? servicio.adultos === "si", dispositivoId, usuarioId, sock)
}

/* ═══════════════════════════════════════════
   SINCRONIZAR CUENTA (comando "renovado")
═══════════════════════════════════════════ */
async function sincronizarCuentaBot(
  sock: WASocket, jid: string, dispositivoId: number, cuenta: any, usuarioId: number
): Promise<void> {
  await sock.sendMessage(jid, { text: "⏳ Estamos procesando tu renovación, un momento..." })
  const datos = await buscarUsuarioIPTV(cuenta.usuario, usuarioId)

  let expiraEn: Date | null = null
  if (datos.expira) {
    const isoMatch = datos.expira.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
    const dmyMatch = datos.expira.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (isoMatch) expiraEn = new Date(`${isoMatch[1]}T${isoMatch[2]}:00Z`)
    else if (dmyMatch) expiraEn = new Date(`${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}T00:00:00Z`)
  }

  // Solo reactivar el recordatorio si la fecha de expiración cambió (cuenta renovada)
  const fechaActual = cuenta.expiraEn ? new Date(cuenta.expiraEn).getTime() : null
  const fechaNueva  = expiraEn ? expiraEn.getTime() : null
  const renovada    = fechaNueva !== null && fechaNueva !== fechaActual

  await prisma.cuentaCliente.update({
    where: { id: cuenta.id },
    data: {
      contrasena:  datos.password   || cuenta.contrasena || null,
      paquete:     datos.paquete    || null,
      conexiones:  datos.conexiones || null,
      ...(expiraEn  ? { expiraEn }                  : {}),
      ...(renovada  ? { recordatorioEnviado: false } : {}),
    },
  })

  const expiraFmt = expiraEn ? fmtCorta(expiraEn) : null

  const srvNombre = cuenta.servicio?.nombre ?? ""

  await sock.sendMessage(jid, {
    text:
      `✅ *¡CUENTA ${srvNombre.toUpperCase()} RENOVADA!*\n\n` +
      `┌───────────────\n` +
      `👤 Usuario: *${datos.usuario}*\n` +
      `🔐 Contraseña: *${datos.password || cuenta.contrasena || "—"}*\n` +
      `└───────────────\n\n` +
      (datos.paquete ? `📦 Plan: *${fmtPlan(datos.paquete)}*\n` : "") +
      (expiraFmt ? `🗓️ Expira: *${expiraFmt}*` : ""),
  })
  console.log(`✅ [Bot ${dispositivoId}] renovado OK → ${cuenta.telefono} | ${datos.usuario} | vence: ${expiraFmt ?? "—"}`)
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

  const { state, saveCreds } = await useMultiFileAuthState(carpetaSesion(dispositivoId))
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

      // Comandos del dueño escritos en el chat de un contacto
      if (msg.key.fromMe) {
        const cmd = texto.trim().toLowerCase()
        const ownerKey = `${usuarioId}:${jidReal}`

        // Estado demo: admin respondió a la pregunta de adultos
        if (userStates.get(ownerKey) === "demo_esperando_adultos") {
          if (cmd === "0" || cmd === "cancelar") {
            limpiarEstadoDemo(ownerKey)
            await sock.sendMessage(jidReal, { text: "❌ Demo cancelada." })
          } else if (cmd === "1" || cmd === "si" || cmd === "sí") {
            try { await handleDemoCreacion(jidReal, ownerKey, true, dispositivoId, usuarioId, sock) }
            catch (err) { console.error(`❌ [Bot ${dispositivoId}] 22 admin adultos:`, err) }
          } else if (cmd === "2" || cmd === "no") {
            try { await handleDemoCreacion(jidReal, ownerKey, false, dispositivoId, usuarioId, sock) }
            catch (err) { console.error(`❌ [Bot ${dispositivoId}] 22 admin sin adultos:`, err) }
          } else {
            await sock.sendMessage(jidReal, { text: MSG_ADULTOS })
          }
          continue
        }

        console.log(`\n${"─".repeat(55)}`)
        console.log(`👤 [Bot ${dispositivoId}] CMD ADMIN | jid: ${jidReal} | cmd: "${texto.trim()}"`)


        // Códigos de demo del servicio → demo forzada (siempre crea nueva, aunque ya tenga demo o estén desactivadas)
        //   codigoDemo           → según la opción "adultos" del servicio
        //   codigoDemoAdultos    → directo con adultos
        //   codigoDemoSinAdultos → directo sin adultos
        const srvDispositivo = await servicioDelDispositivo(dispositivoId)
        if (srvDispositivo) {
          const adultosPorCodigo = new Map<string, boolean | undefined>([
            [normalizarCodigo(srvDispositivo.codigoDemo),           undefined],
            [normalizarCodigo(srvDispositivo.codigoDemoAdultos),    true],
            [normalizarCodigo(srvDispositivo.codigoDemoSinAdultos), false],
          ])
          if (adultosPorCodigo.has(cmd)) {
            const { numeroCompleto } = detectarPais(jidReal)
            try { await manejarDemo(jidReal, numeroCompleto, ownerKey, dispositivoId, usuarioId, sock, true, adultosPorCodigo.get(cmd)) }
            catch (err) { console.error(`❌ [Bot ${dispositivoId}] demo admin "${cmd}":`, err) }
            continue
          }
        }

        // "u: xyz123" → registrar cuenta nueva desde el panel
        if (cmd.startsWith("u:")) {
          const nuevoUsuario = texto.trim().replace(/^u:\s*/i, "").trim()
          console.log(`📥 [Bot ${dispositivoId}] u: → registrar "${nuevoUsuario}" para ${jidReal}`)
          if (nuevoUsuario) {
            const { numeroCompleto, pais } = detectarPais(jidReal)
            try {
              console.log(`📥 [Bot ${dispositivoId}] verificando duplicado en DB...`)
              const yaExiste = await prisma.cuentaCliente.findFirst({
                where: { usuarioId, usuario: nuevoUsuario },
              })
              if (yaExiste) {
                console.log(`⚠️  [Bot ${dispositivoId}] "${nuevoUsuario}" ya existe en DB — abortando`)
                await sock.sendMessage(jidReal, {
                  text: `⚠️ La cuenta *${nuevoUsuario}* ya está registrada en el sistema.`,
                })
                continue
              }

              console.log(`📥 [Bot ${dispositivoId}] buscando en panel IPTV: "${nuevoUsuario}"...`)
              await sock.sendMessage(jidReal, { text: "⏳ Estamos activando tu acceso, un momento..." })

              const srvMastv = srvDispositivo
              console.log(`📥 [Bot ${dispositivoId}] servicioId Puppeteer: ${srvMastv?.id ?? "null"}`)

              const datos = await buscarUsuarioIPTV(nuevoUsuario, usuarioId)
              console.log(`📥 [Bot ${dispositivoId}] datos del panel: usuario="${datos.usuario}" pass="${datos.password}" expira="${datos.expira}" plan="${datos.paquete}"`)

              let expiraEn: Date | null = null
              if (datos.expira) {
                const isoMatch = datos.expira.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
                const dmyMatch = datos.expira.match(/(\d{2})\/(\d{2})\/(\d{4})/)
                if (isoMatch) expiraEn = new Date(`${isoMatch[1]}T${isoMatch[2]}:00Z`)
                else if (dmyMatch) expiraEn = new Date(`${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}T00:00:00Z`)
              }
              console.log(`📥 [Bot ${dispositivoId}] expiraEn parseado: ${expiraEn ?? "null (On first connection)"}`)

              // Resolver plantilla: por país del cliente → por país del dispositivo que atiende → null
              const devPais = (await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { pais: true } }))?.pais ?? undefined
              const plantillaId = await resolverPlantilla(usuarioId, numeroCompleto, devPais)

              console.log(`📥 [Bot ${dispositivoId}] guardando en DB → tel: ${numeroCompleto} | pais: ${pais} | plantillaId: ${plantillaId ?? "null (default)"}`)
              await prisma.cuentaCliente.create({
                data: {
                  usuarioId,
                  telefono:   numeroCompleto,
                  usuario:    datos.usuario,
                  contrasena: datos.password   || null,
                  paquete:    datos.paquete    || null,
                  conexiones: datos.conexiones || null,
                  pais,
                  servicioId: srvMastv?.id ?? null,
                  plantillaRecordatorioId: plantillaId,
                  expiraEn,
                  // Si ya expiró al momento de registrar, no disparar recordatorio
                  recordatorioEnviado: expiraEn ? expiraEn < new Date() : false,
                },
              })

              // Si el usuario era una demo, limpiar los registros de demo
              // (ClienteDemo se borra en cascada al eliminar CuentaDemo)
              const cuentaDemoVieja = await prisma.cuentaDemo.findFirst({
                where: { usuarioId, usuario: datos.usuario },
              })
              if (cuentaDemoVieja) {
                await prisma.cuentaDemo.delete({ where: { id: cuentaDemoVieja.id } })
                console.log(`🧹 [Bot ${dispositivoId}] Demo eliminada del pool → ${datos.usuario}`)
              }

              const expiraStr = expiraEn
                ? expiraEn.toLocaleDateString("es-BO", { timeZone:"UTC", day:"2-digit", month:"2-digit", year:"numeric" })
                : null

              console.log(`✅ [Bot ${dispositivoId}] cuenta registrada OK → ${numeroCompleto} | ${datos.usuario} | vence: ${expiraStr ?? "pendiente"}`)
              const expiraFmt = expiraEn ? fmtCorta(expiraEn) : null

              await sock.sendMessage(jidReal, {
                text:
                  `✅ *¡CUENTA ${(srvMastv?.nombre ?? "").toUpperCase()} ACTIVADA!*\n\n` +
                  `┌───────────────\n` +
                  `👤 Usuario: *${datos.usuario}*\n` +
                  `🔐 Contraseña: *${datos.password || "—"}*\n` +
                  `└───────────────\n\n` +
                  (datos.paquete ? `📦 Plan: *${fmtPlan(datos.paquete)}*\n` : "") +
                  (expiraFmt ? `🗓️ Expira: *${expiraFmt}*` : ""),
              })
            } catch (e: any) {
              console.error(`❌ [Bot ${dispositivoId}] u: ERROR en paso → ${e.message}`)
              console.error(e?.stack?.split("\n").slice(0, 4).join("\n"))
              await sock.sendMessage(jidReal, { text: `⚠️ No se pudo registrar: ${e.message}` })
            }
          }
          continue
        }

        // "smart" / "vu" → parsear mensaje citado y reenviar en formato de app
        if (cmd === "smart" || cmd === "vu") {
          const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
          const quotedText =
            quotedMsg?.conversation ||
            quotedMsg?.extendedTextMessage?.text ||
            quotedMsg?.imageMessage?.caption ||
            quotedMsg?.videoMessage?.caption || ""

          const usuarioParsed =
            quotedText.match(/👤 Usuario: \*([^*\n]+)\*/)?.[1]?.trim() ??
            quotedText.match(/^usuario:\s*(.+)$/im)?.[1]?.trim()
          const contrasenaParsed =
            quotedText.match(/[🔑🔐] Contraseña: \*([^*\n]+)\*/)?.[1]?.trim() ??
            quotedText.match(/^contrase[nñ]a:\s*(.+)$/im)?.[1]?.trim()

          if (!usuarioParsed || !contrasenaParsed) {
            console.log(`⚠️  [Bot ${dispositivoId}] ${cmd}: no se encontraron credenciales en el mensaje citado`)
          } else {
            try {
              const srv = srvDispositivo

              if (cmd === "smart") {
                const url    = srv?.smartersUrl    || "—"
                const nombre = srv?.smartersNombre || "—"
                await sock.sendMessage(jidReal, {
                  text:
                    `🏷️ Name: *${nombre}*\n` +
                    `👤 Usuario: *${usuarioParsed}*\n` +
                    `🔑 Contraseña: *${contrasenaParsed}*\n` +
                    `🌐 URL: *${url}*`,
                })
              } else {
                const url    = srv?.iphoneUrl      || "—"
                const nombre = srv?.smartersNombre || "—"
                await sock.sendMessage(jidReal, {
                  text:
                    `🏷️ Name: *${nombre}*\n` +
                    `👤 Usuario: *${usuarioParsed}*\n` +
                    `🔑 Contraseña: *${contrasenaParsed}*\n` +
                    `🌐 URL: *${url}*`,
                })
              }
            } catch (e: any) {
              console.error(`❌ [Bot ${dispositivoId}] ${cmd}:`, e.message)
            }
          }
          continue
        }

        // "active" (reply) → registrar/actualizar desde panel y mostrar CUENTA ACTIVADA
        if (cmd === "active") {
          const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
          const quotedText =
            quotedMsg?.conversation ||
            quotedMsg?.extendedTextMessage?.text ||
            quotedMsg?.imageMessage?.caption ||
            quotedMsg?.videoMessage?.caption || ""

          let nombreUsuario =
            quotedText.match(/👤[^:]*:\s*\*?([^*\n]+?)\*?\s*$/m)?.[1]?.trim() ??
            quotedText.match(/^usuario:\s*(.+)$/im)?.[1]?.trim()
          if (!nombreUsuario) {
            const primera = quotedText.trim().split("\n")[0].trim().replace(/\*/g, "")
            if (primera && !primera.includes(" ") && primera.length < 50) nombreUsuario = primera
          }

          if (!nombreUsuario) {
            console.log(`⚠️  [Bot ${dispositivoId}] active: no se encontró usuario en el mensaje citado`)
          } else {
            const { numeroCompleto, pais } = detectarPais(jidReal)
            try {
              await sock.sendMessage(jidReal, { text: "⏳ Estamos activando tu acceso, un momento..." })

              const yaExiste = await prisma.cuentaCliente.findFirst({ where: { usuarioId, usuario: nombreUsuario } })
              if (yaExiste) {
                const expiraFmtExiste = yaExiste.expiraEn ? fmtCorta(yaExiste.expiraEn) : null
                await sock.sendMessage(jidReal, {
                  text:
                    `✅ *¡CUENTA ACTIVADA!*\n\n` +
                    `┌───────────────\n` +
                    `👤 Usuario: *${yaExiste.usuario}*\n` +
                    `🔐 Contraseña: *${yaExiste.contrasena || "—"}*\n` +
                    `└───────────────\n\n` +
                    (yaExiste.paquete ? `📦 Plan: *${fmtPlan(yaExiste.paquete)}*\n` : "") +
                    (expiraFmtExiste ? `🗓️ Expira: *${expiraFmtExiste}*` : ""),
                })
              } else {
                const datos = await buscarUsuarioIPTV(nombreUsuario, usuarioId)
                let expiraEn: Date | null = null
                if (datos.expira) {
                  const iso = datos.expira.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
                  const dmy = datos.expira.match(/(\d{2})\/(\d{2})\/(\d{4})/)
                  if (iso) expiraEn = new Date(`${iso[1]}T${iso[2]}:00Z`)
                  else if (dmy) expiraEn = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`)
                }
                const srvMastv = srvDispositivo
                const devPais  = (await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { pais: true } }))?.pais ?? undefined
                const plantillaId = await resolverPlantilla(usuarioId, numeroCompleto, devPais)
                await prisma.cuentaCliente.create({
                  data: {
                    usuarioId,
                    telefono:   numeroCompleto,
                    usuario:    datos.usuario,
                    contrasena: datos.password   || null,
                    paquete:    datos.paquete    || null,
                    conexiones: datos.conexiones || null,
                    pais,
                    servicioId:              srvMastv?.id ?? null,
                    plantillaRecordatorioId: plantillaId,
                    expiraEn,
                    recordatorioEnviado: expiraEn ? expiraEn < new Date() : false,
                  },
                })
                // Limpiar demo si existía
                const demoVieja = await prisma.cuentaDemo.findFirst({ where: { usuarioId, usuario: datos.usuario } })
                if (demoVieja) await prisma.cuentaDemo.delete({ where: { id: demoVieja.id } })

                const expiraFmt = expiraEn ? fmtCorta(expiraEn) : null
                console.log(`✅ [Bot ${dispositivoId}] active → registrado: ${nombreUsuario}`)
                await sock.sendMessage(jidReal, {
                  text:
                    `✅ *¡CUENTA ${(srvMastv?.nombre ?? "").toUpperCase()} ACTIVADA!*\n\n` +
                    `┌───────────────\n` +
                    `👤 Usuario: *${datos.usuario}*\n` +
                    `🔐 Contraseña: *${datos.password || "—"}*\n` +
                    `└───────────────\n\n` +
                    (datos.paquete ? `📦 Plan: *${fmtPlan(datos.paquete)}*\n` : "") +
                    (expiraFmt ? `🗓️ Expira: *${expiraFmt}*` : ""),
                })
              }
            } catch (e: any) {
              if (e?.message?.includes("No se encontró el usuario")) {
                console.log(`🔍 [Bot ${dispositivoId}] active — "${nombreUsuario}" no existe en el panel`)
              } else {
                console.error(`❌ [Bot ${dispositivoId}] active:`, e.message)
                await sock.sendMessage(jidReal, { text: `⚠️ No se pudo activar: ${e.message}` })
              }
            }
          }
          continue
        }

        // "rm" (reply) → renovar cuenta desde panel y mostrar mensaje de renovación
        if (cmd === "rm") {
          const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
          const quotedText =
            quotedMsg?.conversation ||
            quotedMsg?.extendedTextMessage?.text ||
            quotedMsg?.imageMessage?.caption ||
            quotedMsg?.videoMessage?.caption || ""

          let nombreUsuario =
            quotedText.match(/👤[^:]*:\s*\*?([^*\n]+?)\*?\s*$/m)?.[1]?.trim() ??
            quotedText.match(/^usuario:\s*(.+)$/im)?.[1]?.trim()
          if (!nombreUsuario) {
            const primera = quotedText.trim().split("\n")[0].trim().replace(/\*/g, "")
            if (primera && !primera.includes(" ") && primera.length < 50) nombreUsuario = primera
          }

          if (!nombreUsuario) {
            console.log(`⚠️  [Bot ${dispositivoId}] rm: no se encontró usuario en el mensaje citado`)
          } else {
            try {
              await sock.sendMessage(jidReal, { text: "⏳ Estamos procesando tu renovación, un momento..." })
              const datos = await buscarUsuarioIPTV(nombreUsuario, usuarioId)

              let expiraEn: Date | null = null
              if (datos.expira) {
                const iso = datos.expira.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
                const dmy = datos.expira.match(/(\d{2})\/(\d{2})\/(\d{4})/)
                if (iso) expiraEn = new Date(`${iso[1]}T${iso[2]}:00Z`)
                else if (dmy) expiraEn = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`)
              }

              const srvMastv = srvDispositivo
              const yaExiste = await prisma.cuentaCliente.findFirst({ where: { usuarioId, usuario: datos.usuario } })

              if (yaExiste) {
                await prisma.cuentaCliente.update({
                  where: { id: yaExiste.id },
                  data: {
                    contrasena: datos.password   || yaExiste.contrasena,
                    paquete:    datos.paquete    || yaExiste.paquete,
                    conexiones: datos.conexiones || yaExiste.conexiones,
                    expiraEn,
                    recordatorioEnviado: false,
                  },
                })
              } else {
                const { numeroCompleto, pais } = detectarPais(jidReal)
                const devPais    = (await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { pais: true } }))?.pais ?? undefined
                const plantillaId = await resolverPlantilla(usuarioId, numeroCompleto, devPais)
                await prisma.cuentaCliente.create({
                  data: {
                    usuarioId,
                    telefono:   numeroCompleto,
                    usuario:    datos.usuario,
                    contrasena: datos.password   || null,
                    paquete:    datos.paquete    || null,
                    conexiones: datos.conexiones || null,
                    pais,
                    servicioId:              srvMastv?.id ?? null,
                    plantillaRecordatorioId: plantillaId,
                    expiraEn,
                    recordatorioEnviado: expiraEn ? expiraEn < new Date() : false,
                  },
                })
              }

              const expiraFmt = expiraEn ? fmtCorta(expiraEn) : null
              console.log(`🔄 [Bot ${dispositivoId}] rm → renovado: ${datos.usuario}`)
              await sock.sendMessage(jidReal, {
                text:
                  `🔄 *¡Tu cuenta de ${srvMastv?.nombre ?? "servicio"} fue renovada exitosamente!*\n\n` +
                  `┌───────────────\n` +
                  `👤 Usuario: *${datos.usuario}*\n` +
                  `🔐 Contraseña: *${datos.password || "—"}*\n` +
                  `└───────────────\n\n` +
                  (datos.paquete ? `📦 Plan: *${fmtPlan(datos.paquete)}*\n` : "") +
                  (expiraFmt ? `🗓️ Expira: *${expiraFmt}*` : ""),
              })
            } catch (e: any) {
              if (e?.message?.includes("No se encontró el usuario")) {
                console.log(`🔍 [Bot ${dispositivoId}] rm — "${nombreUsuario}" no existe en el panel`)
              } else {
                console.error(`❌ [Bot ${dispositivoId}] rm:`, e.message)
                await sock.sendMessage(jidReal, { text: `⚠️ No se pudo renovar: ${e.message}` })
              }
            }
          }
          continue
        }

        // ".usuario" → mostrar info de cuenta al cliente sin tocar la DB
        if (cmd.startsWith(".") && cmd.length > 1) {
          const nombreUsuario = texto.trim().slice(1).trim()
          try {
            const datos = await buscarUsuarioIPTV(nombreUsuario, usuarioId)

            // Actualizar DB con datos frescos del panel
            const cuenta = await prisma.cuentaCliente.findFirst({
              where: { usuarioId, usuario: nombreUsuario },
            })
            let expiraEn: Date | null = null
            if (datos.expira) {
              const iso = datos.expira.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
              const dmy = datos.expira.match(/(\d{2})\/(\d{2})\/(\d{4})/)
              if (iso) expiraEn = new Date(`${iso[1]}T${iso[2]}:00Z`)
              else if (dmy) expiraEn = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`)
            }
            if (cuenta) {
              const yaVencio = expiraEn ? expiraEn < new Date() : false
              await prisma.cuentaCliente.update({
                where: { id: cuenta.id },
                data: {
                  contrasena: datos.password   || cuenta.contrasena || null,
                  paquete:    datos.paquete    || null,
                  conexiones: datos.conexiones || null,
                  ...(expiraEn ? { expiraEn, recordatorioEnviado: yaVencio ? true : undefined } : {}),
                },
              })
            }

            const expiraFmt = expiraEn ? fmtCorta(expiraEn) : null
            const expirada  = expiraEn ? expiraEn < new Date() : false

            await sock.sendMessage(jidReal, {
              text:
                `📋 *Info de tu Cuenta*\n\n` +
                `┌───────────────\n` +
                `👤 Usuario: *${nombreUsuario}*\n` +
                `🔐 Contraseña: *${datos.password || "—"}*\n` +
                `└───────────────\n\n` +
                (datos.paquete ? `📦 Plan: *${fmtPlan(datos.paquete)}*\n` : "") +
                (expiraFmt
                  ? expirada
                    ? `⚠️ Tu cuenta expiró el *${expiraFmt}*`
                    : `🗓️ Expira: *${expiraFmt}*`
                  : ""),
            })
          } catch (e: any) {
            // Si no existe en el panel → silencio total
            if (e?.message?.includes("No se encontró el usuario")) {
              console.log(`🔍 [Bot ${dispositivoId}] .info — "${nombreUsuario}" no existe en el panel`)
            } else {
              console.error(`❌ [Bot ${dispositivoId}] .info error:`, e.message)
            }
          }
          continue
        }

        // Admin escribe una palabra clave de una regla → ejecutar la regla para el cliente
        if (srvDispositivo && await ejecutarRegla(srvDispositivo.id, cmd, jidReal, dispositivoId, sock)) continue

        // Escribir el usuario directamente → sincronizar con el panel (solo cuentas con servicio)
        if (texto.trim()) {
          console.log(`🔄 [Bot ${dispositivoId}] buscando cuenta con usuario="${texto.trim()}" en DB...`)
          try {
            const cuenta = await prisma.cuentaCliente.findFirst({
              where: { usuarioId, usuario: texto.trim() },
              include: { servicio: true },
            })
            if (!cuenta) {
              console.log(`🔄 [Bot ${dispositivoId}] "${texto.trim()}" no encontrado en DB — ignorando`)
            } else if (!cuenta.servicio) {
              console.log(`🔄 [Bot ${dispositivoId}] "${texto.trim()}" sin servicio — ignorando`)
            } else {
              console.log(`🔄 [Bot ${dispositivoId}] sincronizando "${texto.trim()}"...`)
              await sincronizarCuentaBot(sock, jidReal, dispositivoId, cuenta, usuarioId)
            }
          } catch (e: any) {
            console.error(`❌ [Bot ${dispositivoId}] sincronizar: ${e.message}`)
            await sock.sendMessage(jidReal, { text: `⚠️ Error al sincronizar: ${e.message}` })
          }
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
      qrMostrado.set(dispositivoId, true)
      await prisma.dispositivo.update({ where: { id: dispositivoId }, data: { estado: "esperando_qr" } }).catch(() => {})
    }
    if (connection === "open") {
      info.estado = "conectado"; info.qr = null
      info.telefono = sock.user?.id?.split(":")[0] ?? null
      await prisma.dispositivo.update({
        where: { id: dispositivoId },
        data: { estado: "conectado", telefono: info.telefono, caidoDesde: null },
      }).catch(() => {})

      const fueQR = qrMostrado.get(dispositivoId) ?? false
      qrMostrado.delete(dispositivoId)

      if (fueQR) {
        // Primera vinculación por QR: reconectar internamente para que las
        // notificaciones del celular funcionen desde el primer momento
        console.log(`🔄 [Bot ${dispositivoId}] Primera vinculación — reconectando para activar notificaciones...`)
        setTimeout(() => { try { sock.end(undefined) } catch {} }, 9000)
      } else {
        // Reconexión normal (sin QR): ocultar presencia directamente
        setTimeout(async () => {
          try { await sock.sendPresenceUpdate("unavailable") } catch {}
        }, 3000)
      }
      console.log(`✅ [Bot ${dispositivoId}] Conectado — ${info.telefono}`)
    }
    if (connection === "close") {
      const loggedOut =
        (lastDisconnect?.error as any)?.output?.statusCode === DisconnectReason.loggedOut
      // Pausado o desconectado desde el sistema → cierre a propósito, no es una caída
      const intencional = info.estado === "pausado" || info.estado === "desconectado"
      info.sock = null; info.telefono = null

      // Primera vez que se cae: guardar desde cuándo (el banner avisa si dura más de unos minutos)
      if (!intencional) {
        await prisma.dispositivo.updateMany({
          where: { id: dispositivoId, caidoDesde: null },
          data: { caidoDesde: new Date() },
        }).catch(() => {})
      }

      if (loggedOut) {
        borrarSesion(dispositivoId)
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
    data: { estado: "pausado", telefono: null, caidoDesde: null },
  }).catch(() => {})
}

/* ═══════════════════════════════════════════
   DESCONECTAR COMPLETO — borra auth (pide QR de nuevo)
═══════════════════════════════════════════ */
export async function desconectarDispositivo(dispositivoId: number): Promise<void> {
  const info = dispositivos.get(dispositivoId)
  // Marcar antes del logout: el evento "close" que dispara lo reconoce como intencional
  if (info) { info.estado = "desconectado"; info.qr = null; info.telefono = null }
  if (info?.sock) { try { await info.sock.logout() } catch {}; info.sock = null }
  borrarSesion(dispositivoId)
  await prisma.dispositivo.update({
    where: { id: dispositivoId },
    data: { estado: "desconectado", telefono: null, caidoDesde: null },
  }).catch(() => {})
}

/* ═══════════════════════════════════════════
   ARRANQUE
═══════════════════════════════════════════ */
export async function iniciarBots(): Promise<void> {
  const devs = await prisma.dispositivo.findMany()
  for (const dev of devs) {
    const tieneAuth = tieneSesion(dev.id)
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
