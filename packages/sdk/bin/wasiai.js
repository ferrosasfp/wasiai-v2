#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// WasiAI CLI — wasiai
// ═══════════════════════════════════════════════════════════════════

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')
const readline = require('readline')

const MARKETPLACE = process.env.WASIAI_URL ?? 'https://wasiai.vercel.app'
const CONFIG_DIR  = path.join(process.env.HOME ?? '~', '.wasiai')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const VERSION     = '0.1.0'

const CYAN   = '\x1b[36m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED    = '\x1b[31m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

// ── Helpers ───────────────────────────────────────────────────────────────

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) }
  catch { return {} }
}

function writeConfig(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2))
}

async function apiFetch(path, options = {}) {
  const config = readConfig()
  const url = `${MARKETPLACE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      ...options.headers,
    },
  })
  return { ok: res.ok, status: res.status, data: await res.json() }
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans) }))
}

function logo() {
  console.log(`
${CYAN}${BOLD}  ██╗    ██╗ █████╗ ███████╗██╗ █████╗ ██╗${RESET}
${CYAN}${BOLD}  ██║    ██║██╔══██╗██╔════╝██║██╔══██╗██║${RESET}
${CYAN}${BOLD}  ██║ █╗ ██║███████║███████╗██║███████║██║${RESET}
${CYAN}${BOLD}  ██║███╗██║██╔══██║╚════██║██║██╔══██║██║${RESET}
${CYAN}${BOLD}  ╚███╔███╔╝██║  ██║███████║██║██║  ██║██║${RESET}
${CYAN}${BOLD}   ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═╝╚═╝${RESET}
  ${YELLOW}El marketplace de la economía agéntica${RESET}  v${VERSION}
`)
}

// ── Commands ───────────────────────────────────────────────────────────────

const commands = {
  // wasiai login ─────────────────────────────────────────────────────────────
  async login() {
    logo()
    console.log(`${BOLD}Conecta tu cuenta WasiAI${RESET}`)
    console.log(`\n  1. Ve a ${CYAN}${MARKETPLACE}/api-keys${RESET}`)
    console.log(`  2. Crea una API key`)
    console.log(`  3. Pégala aquí:\n`)
    const key = await prompt(`  API Key: `)
    if (!key.trim()) { console.log(`${RED}  API key vacía${RESET}`); process.exit(1) }

    // Verify
    const { ok, data } = await apiFetch('/api/v1/agent-keys/me', {
      headers: { Authorization: `Bearer ${key.trim()}` },
    })
    if (!ok) { console.log(`${RED}  Key inválida: ${data.error ?? 'error desconocido'}${RESET}`); process.exit(1) }

    writeConfig({ ...readConfig(), apiKey: key.trim() })
    console.log(`\n  ${GREEN}✓ Autenticado correctamente${RESET}`)
  },

  // wasiai whoami ────────────────────────────────────────────────────────────
  async whoami() {
    const config = readConfig()
    if (!config.apiKey) { console.log(`${YELLOW}No autenticado — ejecuta: wasiai login${RESET}`); return }
    const { ok, data } = await apiFetch('/api/v1/agent-keys/me')
    if (!ok) { console.log(`${RED}Error: ${data.error}${RESET}`); return }
    console.log(`${GREEN}✓ Autenticado${RESET}`)
    console.log(`  Presupuesto: $${data.spent ?? 0} / $${data.budget ?? 0} USDC`)
  },

  // wasiai publish ───────────────────────────────────────────────────────────
  async publish() {
    logo()
    const config = readConfig()
    if (!config.apiKey) {
      console.log(`${RED}  No autenticado. Ejecuta: wasiai login${RESET}`)
      process.exit(1)
    }

    // Buscar agent.ts / agent.js en el directorio actual
    const cwd = process.cwd()
    let agentConfig = null

    const candidates = ['agent.ts', 'agent.js', 'src/agent.ts', 'src/agent.js']
    for (const c of candidates) {
      const full = path.join(cwd, c)
      if (fs.existsSync(full)) {
        try {
          // Try to import config (works with compiled JS)
          const mod = require(full)
          agentConfig = mod.default?.config ?? mod.config ?? mod.default
          if (agentConfig?.name) break
        } catch { /* skip */ }
      }
    }

    // También buscar wasiai.json como alternativa
    const jsonPath = path.join(cwd, 'wasiai.json')
    if (!agentConfig && fs.existsSync(jsonPath)) {
      agentConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    }

    if (!agentConfig?.name) {
      console.log(`${YELLOW}  No se encontró agent.ts/agent.js/wasiai.json en este directorio.${RESET}`)
      console.log(`\n  Creando desde cero...\n`)

      agentConfig = {
        name: await prompt('  Nombre del agente: '),
        description: await prompt('  Descripción: '),
        category: await prompt('  Categoría (nlp/code/vision/data/other): '),
        price: parseFloat(await prompt('  Precio por llamada en USDC (default 0.001): ') || '0.001'),
        endpointUrl: await prompt('  URL de tu endpoint (POST): '),
      }
    }

    if (!agentConfig.endpointUrl) {
      agentConfig.endpointUrl = await prompt('  URL de tu endpoint (POST): ')
    }

    console.log(`\n  ${BOLD}Publicando agente...${RESET}`)
    console.log(`  Nombre:     ${agentConfig.name}`)
    console.log(`  Precio:     $${agentConfig.price ?? 0.001} USDC/llamada`)
    console.log(`  Endpoint:   ${agentConfig.endpointUrl}\n`)

    const { ok, data } = await apiFetch('/api/models', {
      method: 'POST',
      body: JSON.stringify({
        name: agentConfig.name,
        description: agentConfig.description,
        category: agentConfig.category ?? 'other',
        price_per_call: agentConfig.price ?? 0.001,
        endpoint_url: agentConfig.endpointUrl,
        capabilities: agentConfig.capabilities ?? [],
        metadata: {
          published_via: '@wasiai/sdk',
          agent_type: agentConfig.type ?? 'agent',
          mcp_tool_name: agentConfig.mcpToolName,
        },
      }),
    })

    if (!ok) {
      console.log(`  ${RED}✗ Error: ${data.error ?? JSON.stringify(data)}${RESET}`)
      process.exit(1)
    }

    const slug = data.agent?.slug ?? data.model?.slug ?? data.slug
    console.log(`  ${GREEN}${BOLD}✓ Agente publicado!${RESET}`)
    console.log(`\n  ${CYAN}Marketplace:${RESET} ${MARKETPLACE}/models/${slug}`)
    console.log(`  ${CYAN}Invoke URL:${RESET}  ${MARKETPLACE}/api/v1/models/${slug}/invoke`)
    console.log(`\n  Comparte este endpoint con otros agentes para empezar a ganar USDC 🚀\n`)
  },

  // wasiai list ──────────────────────────────────────────────────────────────
  async list() {
    const { ok, data } = await apiFetch('/api/v1/agents?limit=20')
    if (!ok) { console.log(`${RED}Error: ${data.error}${RESET}`); return }

    const agents = data.agents ?? data.models ?? []
    if (!agents.length) { console.log(`${YELLOW}No hay agentes publicados aún${RESET}`); return }

    console.log(`\n${BOLD}  Agentes en WasiAI${RESET} (${agents.length} resultados)\n`)
    agents.forEach(a => {
      console.log(`  ${CYAN}${a.slug}${RESET}`)
      console.log(`    ${a.name} — $${a.price_per_call} USDC/call — ${a.total_calls ?? 0} llamadas`)
    })
    console.log()
  },

  // wasiai help ──────────────────────────────────────────────────────────────
  help() {
    logo()
    console.log(`${BOLD}Comandos disponibles:${RESET}`)
    console.log(`  ${CYAN}wasiai login${RESET}    — Conectar tu cuenta WasiAI`)
    console.log(`  ${CYAN}wasiai publish${RESET}  — Publicar tu agente en el marketplace`)
    console.log(`  ${CYAN}wasiai list${RESET}     — Ver agentes publicados`)
    console.log(`  ${CYAN}wasiai whoami${RESET}   — Ver tu sesión actual`)
    console.log(`  ${CYAN}wasiai help${RESET}     — Mostrar esta ayuda`)
    console.log(`\n  ${YELLOW}Docs:${RESET} ${MARKETPLACE}/docs\n`)
  },
}

// ── Main ───────────────────────────────────────────────────────────────────

const [, , cmd = 'help', ...args] = process.argv

if (commands[cmd]) {
  commands[cmd](args).catch(err => {
    console.error(`${RED}Error: ${err.message}${RESET}`)
    process.exit(1)
  })
} else {
  console.log(`${RED}Comando desconocido: ${cmd}${RESET}`)
  commands.help()
  process.exit(1)
}
