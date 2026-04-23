const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const https = require('https');
const qrcode = require('qrcode-terminal');

// =============================================
const CONFIG = {
    VERIPAGOS_USER: 'zandrotja',
    VERIPAGOS_PASS: 'H?F1&crEcz',
    SECRET_KEY: 'c93b4584-2292-46c1-a698-6ae8b4a01d83',
};
// =============================================

const AUTH = 'Basic ' + Buffer.from(`${CONFIG.VERIPAGOS_USER}:${CONFIG.VERIPAGOS_PASS}`).toString('base64');

// Pagos pendientes: movimiento_id -> { jid, monto, intentos, fallos }
const pendientes = new Map();

let sockGlobal = null; // referencia global al socket para usar en el poller

function apiPost(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: 'veripagos.com',
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': AUTH,
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch (e) { reject(new Error('Respuesta invalida: ' + raw)); }
            });
        });
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function enviarMensaje(jid, contenido) {
    if (!sockGlobal) return;
    try {
        await sockGlobal.sendMessage(jid, contenido);
    } catch (e) {
        console.error(`Error enviando mensaje a ${jid}:`, e.message);
    }
}

// Poller global: corre independiente del socket, verifica todos los pagos pendientes
function iniciarPoller() {
    setInterval(async () => {
        if (pendientes.size === 0) return;

        for (const [movimiento_id, pago] of pendientes.entries()) {
            pago.intentos++;

            // Expirar despues de 24h (5760 intentos de 15s)
            if (pago.intentos > 5760) {
                pendientes.delete(movimiento_id);
                await enviarMensaje(pago.jid, { text: 'Tu QR expiro. Escribe pago <monto> para generar uno nuevo.' });
                continue;
            }

            try {
                const check = await apiPost('/api/bcp/verificar-estado-qr', {
                    secret_key: CONFIG.SECRET_KEY,
                    movimiento_id: String(movimiento_id),
                });

                pago.fallos = 0; // resetear fallos consecutivos si la llamada fue exitosa

                if (check.Codigo === 0 && check.Data?.estado === 'Completado') {
                    pendientes.delete(movimiento_id);
                    const r = check.Data.remitente;
                    console.log(`Pago completado: movimiento ${movimiento_id} de ${pago.jid}`);
                    await enviarMensaje(pago.jid, {
                        text:
                            `*Pago Recibido!*\n\n` +
                            `Monto: *Bs. ${check.Data.monto}*\n` +
                            `Remitente: *${r?.nombre || '-'}*\n` +
                            `Banco: *${r?.banco || '-'}*\n\n` +
                            `Gracias por tu pago!`,
                    });
                }

            } catch (e) {
                pago.fallos = (pago.fallos || 0) + 1;
                console.error(`Error verificando movimiento ${movimiento_id} (fallo ${pago.fallos}):`, e.message);
                // No eliminar — se reintenta en el siguiente ciclo
            }
        }
    }, 15000);
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        shouldIgnoreJid: jid => jid === 'status@broadcast',
    });

    sockGlobal = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log('Escanea este QR con WhatsApp');
        }
        if (connection === 'open') {
            sockGlobal = sock;
            console.log(`Bot conectado. Pagos pendientes: ${pendientes.size}`);
        }
        if (connection === 'close') {
            sockGlobal = null;
            const reconnect = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
                : true;
            if (reconnect) {
                console.log('Reconectando...');
                setTimeout(startBot, 3000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const jid = msg.key.remoteJid;
            if (!jid || jid === 'status@broadcast') continue;

            const texto = (
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                ''
            ).trim();

            console.log(`Mensaje de ${jid} (${msg.pushName || '-'}): "${texto}"`);

            if (!texto) continue;

            const match = texto.match(/^pago\s+(\d+(?:[.,]\d{1,2})?)$/i);
            if (!match) continue;

            const monto = parseFloat(match[1].replace(',', '.'));

            try {
                await enviarMensaje(jid, { text: `Generando QR por Bs. ${monto.toFixed(2)}...` });

                const res = await apiPost('/api/bcp/generar-qr', {
                    secret_key: CONFIG.SECRET_KEY,
                    monto,
                    uso_unico: true,
                    vigencia: '0/01:00',
                    detalle: `Pago Servicio`,
                });

                if (res.Codigo !== 0) {
                    await enviarMensaje(jid, { text: `Error: ${res.Mensaje}` });
                    continue;
                }

                const { movimiento_id, qr: qrImg } = res.Data;

                await enviarMensaje(jid, {
                    image: Buffer.from(qrImg, 'base64'),
                    caption:
                        `*QR de Pago Generado*\n\n` +
                        `Monto: *Bs. ${monto.toFixed(2)}*\n` +
                        `Vigencia: 24 horas\n\n` +
                        `Escanea este QR desde tu app para pagar.`,
                });

                // Registrar en el poller global (sobrescribe si ya tenia uno pendiente)
                pendientes.set(movimiento_id, { jid, monto, intentos: 0, fallos: 0 });
                console.log(`Pago registrado: movimiento ${movimiento_id} por Bs. ${monto} para ${jid}`);

            } catch (e) {
                console.error('Error procesando pago:', e.message);
                await enviarMensaje(jid, { text: 'Ocurrio un error, intenta nuevamente.' });
            }
        }
    });
}

// Iniciar poller global UNA sola vez (independiente de reconexiones)
iniciarPoller();

startBot().catch(console.error);