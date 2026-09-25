import { prisma } from "../lib/prisma"
import { getDispositivo, numeroCompletoAJid, detectarPais } from "../bot"
import { buscarUsuarioIPTV } from "./iptvservice"
import fs from "fs"
import path from "path"

const INTERVALO_MS = 60 * 60 * 1000 // cada hora
const delayAleatorio = () => new Promise(r => setTimeout(r, 8000 + Math.random() * 7000)) // 8-15 seg

const src = (c: string) =>
  c.startsWith("http")
    ? { url: c }
    : fs.readFileSync(path.resolve(c.startsWith("/") ? c.slice(1) : c))

function fmtFecha(d: Date): string {
  return d.toLocaleDateString("es-BO", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" })
}

// Fecha de expiración tal como la muestra el panel IPTV ("2026-10-01 14:30" o "01/10/2026")
function parsearFechaPanel(expira: string | undefined): Date | null {
  if (!expira) return null
  const iso = expira.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (iso) return new Date(`${iso[1]}T${iso[2]}:00Z`)
  const dmy = expira.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`)
  return null
}

/* ─────────────────────────────────────────────────────────────────────────────
   Elige el socket para enviar según la configuración "Envío de recordatorios"
   (tabla RutaRecordatorio). El país se detecta por el prefijo del teléfono.
   - País sin número configurado        → no se envía
   - Número configurado desconectado    → no se envía (se reintenta la próxima hora)
   No hay respaldo: siempre sale del número configurado.
───────────────────────────────────────────────────────────────────────────── */
export async function resolverSocketRecordatorio(
  usuarioId: number,
  telefono: string,
): Promise<{ sock: any; error?: undefined } | { sock?: undefined; error: string }> {
  const { pais } = detectarPais(telefono)
  const ruta = await prisma.rutaRecordatorio.findUnique({
    where: { usuarioId_pais: { usuarioId, pais } },
    include: { dispositivo: true },
  })
  if (!ruta) return { error: `No hay número configurado para enviar recordatorios a ${pais}` }

  const info = getDispositivo(ruta.dispositivoId)
  if (info?.estado !== "conectado" || !info.sock)
    return { error: `El número configurado para ${pais} ("${ruta.dispositivo.nombre}") está desconectado` }

  return { sock: info.sock }
}

async function procesarRecordatorios(): Promise<void> {
  try {
    const ahora   = new Date()
    const en24h   = new Date(ahora.getTime() + 24 * 60 * 60 * 1000)
    const hace48h = new Date(ahora.getTime() - 48 * 60 * 60 * 1000)

    const cuentas = await prisma.cuentaCliente.findMany({
      where: {
        recordatorioAuto: true,
        recordatorioEnviado: false,
        expiraEn: { not: null, gte: hace48h, lte: en24h },
        servicio: { tieneRecordatorios: true },
      },
      include: { servicio: true },
    })

    if (cuentas.length === 0) return
    console.log(`⏰ Procesando ${cuentas.length} recordatorio(s) pendiente(s)…`)

    for (const cuenta of cuentas) {
      try {
        // Número que envía: se valida antes de sincronizar para no abrir el panel en vano
        const { sock, error } = await resolverSocketRecordatorio(cuenta.usuarioId, cuenta.telefono)
        if (!sock) {
          console.warn(`⚠️  Recordatorio pendiente → ${cuenta.usuario}: ${error}`)
          continue
        }

        // ── Sincronizar con el panel y verificar la fecha ──
        if (cuenta.servicio) {
          try {
            console.log(`🔍 [recordatorio] Sincronizando panel para ${cuenta.usuario}…`)
            const datos = await buscarUsuarioIPTV(cuenta.usuario, cuenta.usuarioId)
            const panelExpiraEn = parsearFechaPanel(datos.expira)

            await prisma.cuentaCliente.update({
              where: { id: cuenta.id },
              data: {
                contrasena: datos.password   || cuenta.contrasena || null,
                paquete:    datos.paquete    || null,
                conexiones: datos.conexiones || null,
                ...(panelExpiraEn ? { expiraEn: panelExpiraEn } : {}),
              },
            })
            console.log(`💾 [recordatorio] ${cuenta.usuario}: DB actualizada con datos del panel`)

            // Renovada en el panel (vence en más de 24h) → no enviar; queda pendiente para su nueva fecha
            if (panelExpiraEn && panelExpiraEn > en24h) {
              console.log(`📅 [recordatorio] ${cuenta.usuario}: nueva fecha ${fmtFecha(panelExpiraEn)} — pospuesto`)
              continue
            }

            if (panelExpiraEn)  cuenta.expiraEn   = panelExpiraEn
            if (datos.password) cuenta.contrasena = datos.password

            console.log(`✅ [recordatorio] ${cuenta.usuario}: vencimiento confirmado — enviando`)
          } catch (e: any) {
            console.warn(`⚠️  [recordatorio] No se pudo sincronizar panel para ${cuenta.usuario}: ${e.message} — se envía con datos de DB`)
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        // Cargar la plantilla asignada a esta cuenta
        const plantilla = cuenta.plantillaRecordatorioId
          ? await prisma.plantillaRecordatorio.findUnique({ where: { id: cuenta.plantillaRecordatorioId } })
          : null

        const jid      = numeroCompletoAJid(cuenta.telefono)
        const expiraStr = cuenta.expiraEn ? fmtFecha(new Date(cuenta.expiraEn)) : "pronto"
        const yaVencio  = cuenta.expiraEn ? new Date(cuenta.expiraEn) < ahora : false

        if (plantilla) {
          const texto = plantilla.mensaje
            .replace(/\{usuario\}/g,   cuenta.usuario)
            .replace(/\{contrasena\}/g, cuenta.contrasena ?? "")
            .replace(/\{servicio\}/g,  cuenta.servicio?.nombre ?? "")
            .replace(/\{pais\}/g,      cuenta.pais)
            .replace(/\{expira\}/g,    expiraStr)

          const ext = (plantilla.imagenUrl ?? "").split(".").pop()?.toLowerCase() ?? ""

          if (plantilla.tipo === "imagen" && plantilla.imagenUrl) {
            await sock.sendMessage(jid, { image: src(plantilla.imagenUrl), caption: texto })
          } else if (plantilla.tipo === "documento" && plantilla.imagenUrl) {
            const mimeDoc: Record<string, string> = {
              pdf: "application/pdf", doc: "application/msword",
              docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              xls: "application/vnd.ms-excel",
              xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }
            await sock.sendMessage(jid, {
              document: src(plantilla.imagenUrl),
              fileName: texto || `archivo.${ext}`,
              mimetype: mimeDoc[ext] ?? "application/octet-stream",
            })
          } else if (plantilla.tipo === "audio" && plantilla.imagenUrl) {
            await sock.sendMessage(jid, { audio: src(plantilla.imagenUrl), mimetype: "audio/mpeg", ptt: false })
            if (texto) await sock.sendMessage(jid, { text: texto })
          } else {
            await sock.sendMessage(jid, { text: texto })
          }
        } else {
          // Mensaje por defecto si la cuenta no tiene plantilla
          const icono = yaVencio ? "🔴" : "⏰"
          const aviso = yaVencio ? "Tu cuenta ha *vencido*" : "Tu cuenta vence en *menos de 24 horas*"
          const msg =
            `${icono} *AVISO DE VENCIMIENTO*\n\n` +
            `${aviso}.\n\n` +
            `👤 *Usuario:* ${cuenta.usuario}\n` +
            `🔑 *Contraseña:* ${cuenta.contrasena ?? "—"}\n` +
            `📦 *Servicio:* ${cuenta.servicio?.nombre ?? ""}\n` +
            `🗓️ *Vence:* ${expiraStr}\n\n` +
            `Contáctanos para renovar. 🙌`
          await sock.sendMessage(jid, { text: msg })
        }

        // Segundo mensaje: solo el usuario, para que el admin lo copie fácil al renovar
        await sock.sendMessage(jid, { text: cuenta.usuario })

        await prisma.cuentaCliente.update({
          where: { id: cuenta.id },
          data: { recordatorioEnviado: true },
        })
        console.log(`📨 Recordatorio automático → ${cuenta.telefono} (${cuenta.usuario})`)
        await delayAleatorio()
      } catch (e: any) {
        console.error(`❌ Error recordatorio ${cuenta.usuario}:`, e.message)
      }
    }
  } catch (e: any) {
    console.error("❌ Error en procesarRecordatorios:", e.message)
  }
}

async function verificarExpiracionesPendientes(): Promise<void> {
  try {
    const pendientes = await prisma.cuentaCliente.findMany({
      where: {
        expiraEn: null,
        servicioId: { not: null },
      },
      select: { id: true, usuario: true, usuarioId: true },
    })
    if (pendientes.length === 0) return
    console.log(`🔍 [pendientes] Verificando ${pendientes.length} cuenta(s) sin fecha de expiración…`)
    for (const cuenta of pendientes) {
      try {
        const datos = await buscarUsuarioIPTV(cuenta.usuario, cuenta.usuarioId)
        const expiraEn = parsearFechaPanel(datos.expira)
        if (expiraEn) {
          await prisma.cuentaCliente.update({
            where: { id: cuenta.id },
            data: { expiraEn, recordatorioEnviado: false },
          })
          console.log(`✅ [pendientes] ${cuenta.usuario}: fecha obtenida → ${expiraEn.toISOString()}`)
        }
      } catch (e: any) {
        console.warn(`⚠️  [pendientes] No se pudo verificar ${cuenta.usuario}: ${e.message}`)
      }
    }
  } catch (e: any) {
    console.error("❌ [pendientes] Error:", e.message)
  }
}

export function iniciarRecordatorios(): void {
  procesarRecordatorios()
  setInterval(procesarRecordatorios, INTERVALO_MS)
  console.log("⏰ Recordatorios automáticos activos (revisión cada hora)")

  const INTERVALO_PENDIENTES = 6 * 60 * 60 * 1000
  setTimeout(() => {
    verificarExpiracionesPendientes()
    setInterval(verificarExpiracionesPendientes, INTERVALO_PENDIENTES)
  }, 30 * 60 * 1000)
  console.log("🔍 Verificación de expiraciones pendientes activa (cada 6 horas)")
}
