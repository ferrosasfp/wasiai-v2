/**
 * i18n-audit.mjs — Playwright audit con login real via browser
 * Uso: node scripts/i18n-audit.mjs [email] [password]
 */
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const BASE       = 'http://localhost:3000'
const TEST_EMAIL = process.argv[2] || process.env.TEST_EMAIL
const TEST_PASS  = process.argv[3] || process.env.TEST_PASS

const PAGES = [
  { path: '/marketplace',        auth: false },
  { path: '/agent-keys',         auth: true  },
  { path: '/publish',            auth: true  },
  { path: '/pipelines',          auth: true  },
  { path: '/sandbox',            auth: false },
  { path: '/docs',               auth: false },
  { path: '/transparency',       auth: false },
  { path: '/creator/dashboard',  auth: true  },
  { path: '/profile',            auth: true  },
  { path: '/admin',              auth: true  },
]

const ES_IN_EN = [
  'Agregar', 'Busca', 'Cancelar', 'Cerrar sesión', 'Conecta tu', 'Conectar wallet',
  'Configurar', 'Cargando', 'Crear cuenta', 'Depositar', 'Editar agente', 'Eliminar',
  'Fondos', 'Guardar', 'Iniciar sesión', 'Limpiar balances', 'No hay', 'No tienes',
  'Retirar', 'Retiro', 'Sin datos', 'Ver en explorer',
  'Publicar agente', 'Lista tu agente', 'gana USDC', 'por cada llamada',
  'Panel Admin', 'Agentes publicados', 'Wallet del Agente',
  'Tienes un borrador', 'Continuar borrador', 'Configura tu wallet',
  'buscando', 'disponible para', 'agente de IA', 'tu wallet',
  'Ingresa tu', 'Agregar step', 'Configurar pipeline', 'No hay agentes',
]

const EN_IN_ES = [
  'Add USDC', 'Cancel', 'Close Key', 'Connect wallet', 'Create account',
  'Edit agent', 'Featured', 'Loading editor', 'No agent keys yet',
  'Publish Agent', 'Rate this agent', 'Revenue', 'Search agents',
  'Sign in', 'Sign out', 'Spent', 'Total Calls', 'Withdraw funds',
  'Agent Wallet', 'Admin Panel', 'Published agents', 'Clean balances',
  'Funds for agentic', 'searching', 'Pipeline Builder', 'Configure pipeline',
  'List your AI agent', 'earn USDC per call', 'You have an unpublished draft',
  'Add step', 'Enter your API key',
]

async function extractVisible(page) {
  return page.evaluate(() => {
    const texts = []
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const p = node.parentElement
          if (!p) return NodeFilter.FILTER_REJECT
          const tag = p.tagName.toLowerCase()
          if (['script','style','code','pre','noscript','textarea'].includes(tag)) return NodeFilter.FILTER_REJECT
          const style = window.getComputedStyle(p)
          if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        }
      }
    )
    let node
    while ((node = walker.nextNode())) {
      const t = node.textContent?.trim() ?? ''
      if (t.length > 3) texts.push(t)
    }
    return texts
  })
}

async function loginViaBrowser(page) {
  if (!TEST_EMAIL || !TEST_PASS) {
    console.log('⚠  No TEST_EMAIL/TEST_PASS — páginas con auth serán skipped')
    return false
  }

  console.log(`🔐 Logging in as ${TEST_EMAIL}...`)
  await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded', timeout: 10000 })
  await page.waitForTimeout(800)

  // Llenar email
  const emailInput = page.locator('input[type="email"], input[name="email"]').first()
  await emailInput.fill(TEST_EMAIL)

  // Llenar password si hay campo
  const passInput = page.locator('input[type="password"], input[name="password"]').first()
  const passCount = await passInput.count()
  if (passCount > 0) {
    await passInput.fill(TEST_PASS)
    await passInput.press('Enter')
  } else {
    // Magic link / OTP — no podemos automatizar
    console.log('⚠  No password field found. Trying form submit...')
    await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Iniciar")').first().click()
  }

  await page.waitForTimeout(3000)

  const url = page.url()
  const ok  = !url.includes('/login') && !url.includes('/auth/')
  console.log(ok ? `✅ Login OK (→ ${url})` : `⚠  Still on login page (${url})`)
  return ok
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const ctx     = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page    = await ctx.newPage()

  const loggedIn = await loginViaBrowser(page)

  const issues = []

  for (const locale of ['en', 'es']) {
    const badWords = locale === 'en' ? ES_IN_EN : EN_IN_ES
    const label    = locale === 'en' ? 'ES text in EN' : 'EN text in ES'

    for (const { path, auth } of PAGES) {
      if (auth && !loggedIn) {
        console.log(`SKIP (no auth) /${locale}${path}`)
        continue
      }

      const url = `${BASE}/${locale}${path}`
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 })
        await page.waitForTimeout(1200)

        const finalUrl = page.url()
        if (finalUrl.includes('/login') || finalUrl.includes('/auth/')) {
          console.log(`SKIP (redirected to auth) ${url}`)
          continue
        }

        const texts = await extractVisible(page)

        for (const text of texts) {
          for (const word of badWords) {
            if (text.includes(word)) {
              issues.push({ locale, path, text: text.slice(0, 120), word, label })
              break
            }
          }
        }
        console.log(`✓ /${locale}${path} (${texts.length} nodes)`)
      } catch (e) {
        console.log(`SKIP ${url}: ${e.message.slice(0, 80)}`)
      }
    }
  }

  await browser.close()

  const seen   = new Set()
  const unique = issues.filter(i => {
    const key = `${i.locale}|${i.path}|${i.word}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const grouped = {}
  for (const i of unique) {
    const k = `/${i.locale}${i.path}`
    grouped[k] = grouped[k] ?? []
    grouped[k].push(i)
  }

  console.log('\n====== I18N AUDIT RESULTS ======\n')
  let total = 0
  for (const [p, list] of Object.entries(grouped).sort()) {
    console.log(`\n📄 ${p}:`)
    for (const i of list) {
      console.log(`   ⚠  [${i.label}] keyword="${i.word}"`)
      console.log(`      → "${i.text}"`)
      total++
    }
  }
  console.log(`\n→ Total issues: ${total}`)
  if (total === 0) console.log('🎉 Zero i18n issues found!')
}

main().catch(console.error)
