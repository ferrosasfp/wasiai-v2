import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'

const PAGES = [
  { path: '/marketplace' },
  { path: '/agent-keys' },
  { path: '/publish' },
  { path: '/pipelines' },
  { path: '/sandbox' },
  { path: '/docs' },
  { path: '/transparency' },
  { path: '/creator/dashboard' },
  { path: '/profile' },
  { path: '/admin' },
]

// Palabras que NO deben aparecer en /en/ (texto claramente en ES)
const ES_IN_EN = [
  'Agregar', 'Busca', 'Cancelar', 'Cerrar sesión', 'Conecta', 'Conectar wallet',
  'Configurar', 'Cargando', 'Crear cuenta', 'Disponible', 'Editar', 'Eliminar',
  'Fondos', 'Guardar', 'Iniciar sesión', 'Mercado', 'No hay', 'No tienes',
  'Publicar', 'Retirar', 'Retiro', 'Sin datos', 'Ver en explorer',
  'buscando', 'disponible para', 'ejecutar', 'tu wallet',
  'Wallet del Agente', 'Panel Admin', 'Agentes publicados',
  'Fondos para', 'Depositar', 'Limpiar balances',
  'Lista tu agente', 'gana USDC', 'Tienes un borrador', 'Continuar borrador',
  'Configura tu wallet', 'agente de IA', 'por cada llamada',
]

// Palabras que NO deben aparecer en /es/ (texto claramente en EN)
const EN_IN_ES = [
  'Add USDC', 'Cancel', 'Close Key', 'Connect wallet', 'Create account',
  'Edit', 'Featured', 'Loading editor', 'No agent keys yet',
  'Publish', 'Rate this agent', 'Revenue', 'Search agents',
  'Sign in', 'Sign out', 'Spent', 'Total Calls', 'Withdraw funds',
  'Agent Wallet', 'Admin Panel', 'Published agents', 'Clean balances',
  'Funds for agentic', 'searching', 'Pipeline Builder',
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
          if (['script','style','code','pre','noscript','head'].includes(tag)) return NodeFilter.FILTER_REJECT
          // Skip hidden elements
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

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const ctx     = await browser.newContext()
  const page    = await ctx.newPage()

  const issues = []

  for (const locale of ['en', 'es']) {
    const badWords = locale === 'en' ? ES_IN_EN : EN_IN_ES
    const label    = locale === 'en' ? 'ES text in EN' : 'EN text in ES'

    for (const { path } of PAGES) {
      const url = `${BASE}/${locale}${path}`
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
        await page.waitForTimeout(800)
        const texts = await extractVisible(page)

        for (const text of texts) {
          for (const word of badWords) {
            if (text.includes(word)) {
              issues.push({ locale, path, text: text.slice(0, 100), word, label })
              break
            }
          }
        }
      } catch (e) {
        console.log(`SKIP ${url}: ${e.message.slice(0,80)}`)
      }
    }
  }

  await browser.close()

  // Deduplicate
  const seen = new Set()
  const unique = issues.filter(i => {
    const key = `${i.locale}|${i.path}|${i.word}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Group
  const grouped = {}
  for (const i of unique) {
    const k = `/${i.locale}${i.path}`
    grouped[k] = grouped[k] ?? []
    grouped[k].push(i)
  }

  console.log('\n====== I18N AUDIT ======\n')
  let total = 0
  for (const [p, list] of Object.entries(grouped).sort()) {
    console.log(`\n📄 ${p}:`)
    for (const i of list) {
      console.log(`   ⚠  [${i.label}] word="${i.word}" → "${i.text}"`)
      total++
    }
  }
  console.log(`\n→ Total issues: ${total}`)
}

main().catch(console.error)
