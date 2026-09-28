import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer'
import { prisma } from '../lib/prisma'

let browser: Browser | null = null
// Cada usuario usa su propio contexto (cookies/sesión del panel aisladas): nadie opera con la sesión de otro
const contextos = new Map<number, Promise<BrowserContext>>()

const PANEL_BASES = [
  'https://resellermastv.com:8443',
  'http://resellermastv.com:8080',
]
let activePanelIndex = 0

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Faltan credenciales: reintentar no sirve de nada
class SinCredencialesPanel extends Error {}

async function conReintentos<T>(fn: () => Promise<T>, intentos = 3, espera = 2500): Promise<T> {
  let ultimoError: Error | null = null
  for (let i = 1; i <= intentos; i++) {
    try {
      return await fn()
    } catch (e: any) {
      if (e instanceof SinCredencialesPanel) throw e
      ultimoError = e
      console.warn(`⚠️  [Puppeteer] intento ${i}/${intentos} falló: ${e.message}`)
      if (i < intentos) await delay(espera)
    }
  }
  throw ultimoError ?? new Error('Todos los intentos fallaron')
}

async function getPanelCredentials(usuarioId: number): Promise<{ username: string; password: string }> {
  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { panelUsuario: true, panelPassword: true },
  })
  const username = u?.panelUsuario?.trim()
  const password = u?.panelPassword?.trim()
  // Sin valores por defecto: cada usuario opera solo con su propia cuenta del panel
  if (!username || !password)
    throw new SinCredencialesPanel('Faltan las credenciales del panel IPTV. Configúralas en "Panel IPTV".')
  return { username, password }
}

async function navegarConLogin(page: Page, path: string, usuarioId: number): Promise<void> {
  const creds = await getPanelCredentials(usuarioId)

  const intentar = async (baseIndex: number): Promise<void> => {
    const url = `${PANEL_BASES[baseIndex]}${path}`
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    const esLoginPage = await page.$('input[placeholder="Email/Username"]') !== null
    if (!esLoginPage) return
    await page.type('#username', creds.username, { delay: 80 })
    await page.type('#password', creds.password, { delay: 80 })
    const rememberMe = await page.$('#remember_me')
    if (rememberMe) await rememberMe.click()
    await page.click('button[type="submit"]')
    await page.waitForNavigation({ waitUntil: 'networkidle2' })
    await delay(600)
    await page.keyboard.press('Escape')
    await delay(400)
    await page.goto(`${PANEL_BASES[baseIndex]}${path}`, { waitUntil: 'networkidle2' })
  }
  try {
    await intentar(activePanelIndex)
  } catch (e: any) {
    const fallback = activePanelIndex === 0 ? 1 : 0
    activePanelIndex = fallback
    await intentar(fallback)
  }
}

function generarUsuario(): string {
  const l = 'abcdefghijkmnopqrstuvwxyz' // sin "l" para evitar confusión visual
  const n = '0123456789'
  const r = () => l[Math.floor(Math.random() * l.length)]
  return r() + r() + r() +
    n[Math.floor(Math.random() * 10)] +
    n[Math.floor(Math.random() * 10)] +
    n[Math.floor(Math.random() * 10)]
}

async function initBrowser(): Promise<void> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      slowMo: 0,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized',
        '--disable-save-password-bubble',
        '--disable-features=PasswordManager,PasswordCheck,PasswordLeakDetection,SafeBrowsing,SafeBrowsingEnhancedProtection,AutofillEnablePasswordManagerReauthentication',
        '--disable-password-generation',
        '--disable-client-side-phishing-detection',
        '--disable-sync',
        '--use-mock-keychain',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    })
    browser.on('disconnected', () => { browser = null; contextos.clear() })
  }
}

// Página nueva dentro del contexto (sesión del panel) del usuario
async function nuevaPagina(usuarioId: number): Promise<Page> {
  await initBrowser()
  let ctx = contextos.get(usuarioId)
  if (!ctx) {
    ctx = browser!.createBrowserContext()
    contextos.set(usuarioId, ctx)
    ctx.catch(() => contextos.delete(usuarioId))
  }
  return (await ctx).newPage()
}

async function filtrarPorUsuario(page: Page, usuario: string): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('tr.mantine-Table-tr').length > 0, { timeout: 20000 })
  await delay(2000)
  const selector = '.mantine-TextInput-input[placeholder="Search"]'
  await page.waitForSelector(selector, { visible: true })
  await page.click(selector)
  await page.keyboard.down('Control')
  await page.keyboard.press('A')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.type(selector, usuario, { delay: 200 })
  try {
    await page.waitForFunction(
      (u) => Array.from(document.querySelectorAll('tr.mantine-Table-tr')).some(r => r.textContent?.includes(u)),
      { timeout: 20000 },
      usuario
    )
  } catch {
    throw new Error(`No se encontró el usuario: ${usuario}`)
  }
}

async function seleccionarPaquete(page: Page, texto: string): Promise<void> {
  await page.waitForSelector('.select2-selection', { visible: true })
  await page.click('.select2-selection')
  await page.type('.select2-search__field', texto, { delay: 120 })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => {
    const el = document.querySelector('.select2-selection__rendered')
    return !!(el && el.textContent && el.textContent.trim().length > 0)
  })
}

async function quitarCanalesAdultos(page: Page): Promise<void> {
  const adultValues = ['103', '105', '153']
  await page.evaluate((vals) => {
    document.querySelectorAll<HTMLSelectElement>('select').forEach(sel => {
      if (sel.name?.includes('bouquet') || sel.id?.includes('bouquet'))
        Array.from(sel.options).forEach(opt => { if (vals.includes(opt.value)) opt.selected = false })
    })
  }, adultValues)
  await delay(500)
}

async function seleccionarCanalesAdultos(page: Page): Promise<void> {
  const adultValues = ['103', '105', '153']
  await page.evaluate((vals) => {
    document.querySelectorAll<HTMLSelectElement>('select').forEach(sel => {
      if (sel.name?.includes('bouquet') || sel.id?.includes('bouquet'))
        Array.from(sel.options).forEach(opt => { if (vals.includes(opt.value)) opt.selected = true })
    })
  }, adultValues)
  await delay(500)
}

async function intentarCrearUsuario(planTexto: string, incluirAdultos = true, usuarioId: number): Promise<{ usuario: string; password: string; plan: string; expira: string }> {
  const page = await nuevaPagina(usuarioId)
  const usuario = generarUsuario()
  try {
    await navegarConLogin(page, '/lines/create-with-package', usuarioId)
    await page.type('input[name="username"]', usuario)
    await seleccionarPaquete(page, planTexto)
    await delay(3000)
    if (!incluirAdultos) await quitarCanalesAdultos(page)
    await page.evaluate(() => { document.querySelector<HTMLButtonElement>('#submitBtn')?.closest('form')?.submit() })
    await page.waitForNavigation({ waitUntil: 'networkidle2' })
    await filtrarPorUsuario(page, usuario)
    const data = await page.evaluate((usuario) => {
      const rows = Array.from(document.querySelectorAll('tr.mantine-Table-tr'))
      for (const row of rows) {
        const username = row.querySelector('td[data-index="2"] p')?.textContent?.trim()
        if (username !== usuario) continue
        return {
          usuario: username,
          password: row.querySelector('td[data-index="3"] p')?.textContent?.trim() || '',
          expira: row.querySelector('td[data-index="5"] p')?.getAttribute('title') || row.querySelector('td[data-index="5"] p')?.textContent?.trim() || '',
          paquete: row.querySelector('td[data-index="7"]')?.textContent?.trim() || ''
        }
      }
      return null
    }, usuario)
    if (!data || !data.password) throw new Error('No se pudo extraer datos de la cuenta creada')
    return { usuario: data.usuario, password: data.password, plan: data.paquete, expira: data.expira }
  } finally {
    await page.close()
  }
}

export async function crearUsuarioIPTV(planTexto: string, incluirAdultos = true, usuarioId: number): Promise<{ usuario: string; password: string; plan: string; expira: string }> {
  let ultimoError: Error | null = null
  for (let intento = 1; intento <= 3; intento++) {
    try {
      return await intentarCrearUsuario(planTexto, incluirAdultos, usuarioId)
    } catch (e: any) {
      if (e instanceof SinCredencialesPanel) throw e
      ultimoError = e
      if (intento < 3) await delay(2000)
    }
  }
  throw ultimoError ?? new Error('No se pudo crear el usuario IPTV')
}

async function implBuscarUsuarioIPTV(usuario: string, usuarioId: number): Promise<{ usuario: string; password: string; reseller: string; expira: string; baneado: string; paquete: string; trial: string; conexiones: string; creado: string }> {
  const page = await nuevaPagina(usuarioId)
  try {
    await navegarConLogin(page, '/lines', usuarioId)
    await filtrarPorUsuario(page, usuario)
    const data = await page.evaluate((usuario) => {
      const rows = Array.from(document.querySelectorAll('tr.mantine-Table-tr'))
      for (const row of rows) {
        const username = row.querySelector('td[data-index="2"] p')?.textContent?.trim()
        if (username !== usuario) continue
        return {
          usuario,
          password:   row.querySelector('td[data-index="3"] p')?.textContent?.trim() || '',
          reseller:   row.querySelector('td[data-index="4"] p')?.textContent?.trim() || '',
          expira:     row.querySelector('td[data-index="5"] p')?.getAttribute('title') || row.querySelector('td[data-index="5"] p')?.textContent?.trim() || '',
          baneado:    '',
          paquete:    row.querySelector('td[data-index="7"]')?.textContent?.trim() || '',
          trial:      '',
          conexiones: row.querySelector('td[data-index="9"] p')?.textContent?.trim() || '',
          creado:     row.querySelector('td[data-index="13"]')?.textContent?.trim() || ''
        }
      }
      return null
    }, usuario)
    if (!data) throw new Error(`No se encontró el usuario: ${usuario}`)
    return data
  } finally {
    await page.close()
  }
}

async function implRenovarUsuarioIPTV(usuario: string, planTexto: string, usuarioId: number): Promise<void> {
  const page = await nuevaPagina(usuarioId)
  try {
    await navegarConLogin(page, '/lines', usuarioId)
    await filtrarPorUsuario(page, usuario)
    await delay(2000)
    const adjustButtonClicked = await page.evaluate((usuario) => {
      const rows = Array.from(document.querySelectorAll('tr.mantine-Table-tr'))
      for (const row of rows) {
        const username = row.querySelector('td[data-index="2"] p')?.textContent?.trim()
        if (username === usuario) {
          const actionsCell = row.querySelector('td[data-index="14"]')
          const buttons = actionsCell?.querySelectorAll('button.mantine-ActionIcon-root[data-variant="light"]')
          if (buttons) {
            for (const btn of Array.from(buttons)) {
              if (btn.querySelector('svg.tabler-icon-adjustments')) { (btn as HTMLElement).click(); return true }
            }
          }
        }
      }
      return false
    }, usuario)
    if (!adjustButtonClicked) throw new Error('No se encontró el botón de ajustes')
    await delay(1000)
    await page.waitForSelector('[role="menu"]', { timeout: 5000 })
    const renewClicked = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('button[role="menuitem"]'))
      for (const item of items) {
        const label = item.querySelector('.mantine-Menu-itemLabel')?.textContent?.trim()
        if (label?.includes('Renew') && label?.includes('extend')) { (item as HTMLElement).click(); return true }
      }
      return false
    })
    if (!renewClicked) throw new Error('No se encontró la opción Renew (extend)')
    await delay(2000)
    await page.waitForSelector('.mantine-Select-input', { visible: true, timeout: 10000 })
    await delay(1000)
    await page.click('.mantine-Select-input')
    await delay(800)
    await page.type('.mantine-Select-input', planTexto, { delay: 100 })
    await delay(1000)
    const optionSelected = await page.evaluate((planTexto) => {
      const options = Array.from(document.querySelectorAll('[role="option"]'))
      for (const option of options) {
        if (option.textContent?.trim().includes(planTexto)) { (option as HTMLElement).click(); return true }
      }
      return false
    }, planTexto)
    if (!optionSelected) {
      await page.evaluate(() => { const first = document.querySelector('[role="option"]'); if (first) (first as HTMLElement).click() })
    }
    await delay(1500)
    const renewButtonClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button.mantine-Button-root'))
      for (const btn of buttons) {
        const label = btn.querySelector('.mantine-Button-label')?.textContent?.trim()
        if (label === 'Renew' && btn.querySelector('svg.tabler-icon-shopping-cart-plus')) { (btn as HTMLElement).click(); return true }
      }
      return false
    })
    if (!renewButtonClicked) throw new Error('No se encontró el botón Renew verde')
    await delay(3000)
  } finally {
    await page.close()
  }
}

async function implLeerCreditosPanel(usuarioId: number): Promise<number | null> {
  const page = await nuevaPagina(usuarioId)
  try {
    await navegarConLogin(page, '/dashboard', usuarioId)
    await page.waitForFunction(() => {
      const candidatos = document.querySelectorAll('p[data-size="xs"]')
      for (const p of candidatos) {
        const style = p.getAttribute('style') || ''
        if (!style.includes('margin-left')) continue
        const val = parseFloat((p as HTMLElement).innerText?.trim() || '')
        if (!isNaN(val) && val > 0) return true
      }
      return false
    }, { timeout: 20000 })
    const creditos = await page.evaluate(() => {
      const candidatos = document.querySelectorAll('p[data-size="xs"]')
      for (const p of candidatos) {
        if (!(p.getAttribute('style') || '').includes('margin-left')) continue
        const val = parseFloat((p as HTMLElement).innerText?.trim() || '')
        if (!isNaN(val) && val > 0) return val
      }
      return null
    })
    return typeof creditos === 'number' && !isNaN(creditos) ? creditos : null
  } catch {
    return null
  } finally {
    await page.close()
  }
}

// Cerrar la sesión del panel de un usuario (p. ej. al cambiar sus credenciales): el resto sigue igual
export async function cerrarSesionPanel(usuarioId: number): Promise<void> {
  const ctx = contextos.get(usuarioId)
  contextos.delete(usuarioId)
  if (ctx) await (await ctx).close().catch(() => {})
}

export async function cerrarNavegador(): Promise<void> {
  contextos.clear()
  if (browser) { await browser.close(); browser = null }
}

// ── Exports con reintentos automáticos ───────────────────────────────────────
export async function buscarUsuarioIPTV(usuario: string, usuarioId: number) {
  return conReintentos(() => implBuscarUsuarioIPTV(usuario, usuarioId))
}

export async function renovarUsuarioIPTV(usuario: string, planTexto: string, usuarioId: number) {
  return conReintentos(() => implRenovarUsuarioIPTV(usuario, planTexto, usuarioId))
}

export async function leerCreditosPanel(usuarioId: number) {
  return conReintentos(() => implLeerCreditosPanel(usuarioId))
}
