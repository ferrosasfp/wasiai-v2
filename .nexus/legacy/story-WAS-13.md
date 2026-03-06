# Story File — WAS-13: CLI `wasiai invoke`

**HU:** WAS-13  
**NNN:** 026  
**Package:** `@wasiai/cli`  
**Directorio destino:** `/home/ferdev/.openclaw/workspace/wasiai-cli/`  
**Estado:** HU_APPROVED ✅ | SPEC_APPROVED ✅

---

## Objetivo

Crear el package npm `@wasiai/cli` que permite invocar agentes WasiAI desde la terminal:

```bash
wasiai invoke my-agent-slug 'hola, ¿qué puedes hacer?' --key sk_wai_xxx
```

El CLI consume `POST /api/v1/agents/[slug]/invoke` con header `X-API-Key`.

---

## Contrato del Endpoint (leído en route.ts)

```
POST https://wasiai.vercel.app/api/v1/agents/{slug}/invoke
Header: X-API-Key: <api_key>
Body:   { "input": "<texto>" }

Response 200: { "output": "...", "latencyMs": 432 }  (proxied desde canonical)
Response 402: { "error": "payment_required" | "use_trial_endpoint", ... }
Response 502: { "error": "invoke_proxy_error" }
```

---

## Estructura del Package a Crear

```
/home/ferdev/.openclaw/workspace/wasiai-cli/
├── bin/
│   └── wasiai.js          ← entry point ejecutable
├── src/
│   ├── commands/
│   │   └── invoke.js      ← lógica del comando
│   ├── config.js          ← URLs por env
│   └── output.js          ← formateadores
├── package.json
├── .npmrc
└── README.md
```

---

## Archivos a Crear (código completo)

### `package.json`
```json
{
  "name": "@wasiai/cli",
  "version": "1.0.0",
  "description": "WasiAI CLI — invoke agents from the terminal",
  "type": "module",
  "bin": {
    "wasiai": "./bin/wasiai.js"
  },
  "scripts": {
    "start": "node bin/wasiai.js",
    "test": "node --test",
    "prepublishOnly": "node --version"
  },
  "dependencies": {
    "commander": "^12.0.0"
  },
  "engines": {
    "node": ">=18"
  },
  "publishConfig": {
    "access": "public"
  },
  "keywords": ["wasiai", "cli", "ai", "agents", "invoke"],
  "license": "MIT"
}
```

### `.npmrc`
```
access=public
```

### `bin/wasiai.js`
```js
#!/usr/bin/env node
import { program } from 'commander'
import { invokeCommand } from '../src/commands/invoke.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

program
  .name('wasiai')
  .description('WasiAI CLI — invoke agents from the terminal')
  .version(pkg.version)

program
  .command('invoke <slug> <input>')
  .description('Invoke a WasiAI agent by slug')
  .option('--key <apikey>', 'API key (or env WASIAI_API_KEY)')
  .option('--format <format>', 'Output format: json | text', 'text')
  .option('--env <env>', 'Environment: fuji | mainnet', 'mainnet')
  .action(invokeCommand)

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message)
  process.exit(1)
})
```

### `src/config.js`
```js
export const BASE_URLS = {
  mainnet: 'https://wasiai.vercel.app',
  fuji:    'https://wasiai.vercel.app',  // staging — actualizar cuando exista URL propia
}

export const INVOKE_TIMEOUT_MS = 35_000  // 35s > 30s del servidor
```

### `src/output.js`
```js
/**
 * Formatea el resultado según --format
 * @param {string} raw - texto crudo de la respuesta
 * @param {'json'|'text'} format
 */
export function formatOutput(raw, format) {
  if (format === 'json') {
    return raw
  }

  // format === 'text': intentar extraer campo `output`
  try {
    const parsed = JSON.parse(raw)
    if (parsed.output !== undefined) return String(parsed.output)
    // Si no hay campo output, retornar JSON pretty
    return JSON.stringify(parsed, null, 2)
  } catch {
    // No es JSON — retornar raw
    return raw
  }
}
```

### `src/commands/invoke.js`
```js
import { BASE_URLS, INVOKE_TIMEOUT_MS } from '../config.js'
import { formatOutput } from '../output.js'

/**
 * Comando: wasiai invoke <slug> <input> [options]
 */
export async function invokeCommand(slug, input, options) {
  // 1. Resolver API key
  const apiKey = options.key || process.env.WASIAI_API_KEY
  if (!apiKey) {
    console.error('Error: API key required. Use --key <apikey> or set WASIAI_API_KEY env var.')
    process.exit(1)
  }

  // 2. Resolver URL base
  const baseUrl = BASE_URLS[options.env]
  if (!baseUrl) {
    console.error(`Error: Unknown env "${options.env}". Use: fuji | mainnet`)
    process.exit(1)
  }

  const url = `${baseUrl}/api/v1/agents/${encodeURIComponent(slug)}/invoke`

  // 3. Invocar
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(INVOKE_TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.error('Error: Request timed out after 35s.')
    } else {
      console.error(`Error: Could not reach WasiAI — ${err.message}`)
    }
    process.exit(1)
  }

  const raw = await response.text()

  // 4. Manejar errores HTTP
  if (!response.ok) {
    let errMsg = `Error ${response.status}`
    try {
      const parsed = JSON.parse(raw)
      errMsg += `: ${parsed.error || parsed.message || raw}`
    } catch {
      errMsg += `: ${raw}`
    }
    console.error(errMsg)
    process.exit(1)
  }

  // 5. Output en stdout
  const output = formatOutput(raw, options.format || 'text')
  process.stdout.write(output + '\n')
  process.exit(0)
}
```

### `README.md`
```markdown
# @wasiai/cli

CLI para invocar agentes WasiAI desde la terminal.

## Instalación

```bash
npm install -g @wasiai/cli
```

O sin instalar:

```bash
npx @wasiai/cli invoke <slug> '<input>' --key <api_key>
```

## Uso

```bash
wasiai invoke <slug> '<input>' [opciones]

Opciones:
  --key <apikey>        API key (o env WASIAI_API_KEY)
  --format <json|text>  Formato de salida [default: text]
  --env <fuji|mainnet>  Entorno [default: mainnet]
  -V, --version         Versión
  -h, --help            Ayuda
```

## Ejemplos

```bash
# Invocación básica
wasiai invoke translator 'translate hello to spanish' --key sk_wai_xxx

# Output JSON completo
wasiai invoke translator 'hello' --key sk_wai_xxx --format json

# Con env var
export WASIAI_API_KEY=sk_wai_xxx
wasiai invoke translator 'hello'
```

## Exit codes

- `0` — Éxito
- `1` — Error (API key faltante, error HTTP, timeout)
```

---

## Waves de Implementación

### W0 — Setup (serial)
1. `mkdir -p /home/ferdev/.openclaw/workspace/wasiai-cli`
2. Crear `package.json`
3. `cd wasiai-cli && npm install`

### W1 — Core (paralelo)
- Crear `src/config.js`
- Crear `src/output.js`
- Crear `src/commands/invoke.js`
- Crear `bin/wasiai.js`

### W2 — Docs + Publish prep (serial)
1. Crear `README.md`
2. Crear `.npmrc`
3. Verificar: `node bin/wasiai.js --help`

---

## Comando de Verificación

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-cli
node bin/wasiai.js invoke <slug> '<input>' --key <api_key>
```

Resultado esperado:
- stdout: texto de respuesta del agente
- `echo $?` = 0

Test de error (sin key):
```bash
node bin/wasiai.js invoke some-agent 'hola'
# stderr: Error: API key required...
# echo $? = 1
```

---

## Publicación en npm

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-cli

# Asegurarse de estar logueado
npm login

# Publicar
npm publish --access public

# Verificar
npm info @wasiai/cli
```

---

## Anti-Hallucination Protocol (para Dev)

Antes de implementar cada archivo:
1. Verificar que `commander` esté en `package.json` antes de importarlo
2. Verificar que `fetch` esté disponible en Node 18+ (sin imports extra)
3. NO usar `require()` — solo `import` (ESM)
4. El shebang `#!/usr/bin/env node` DEBE ser la primera línea de `bin/wasiai.js`

---

## DoD (Definition of Done)

- [ ] `node bin/wasiai.js invoke <slug> '<input>' --key <key>` funciona (exit 0, output en stdout)
- [ ] Sin `--key` → exit 1, stderr correcto
- [ ] `--format json` retorna JSON completo
- [ ] `--format text` retorna solo el campo `output`
- [ ] `--env fuji` y `--env mainnet` construyen URL correcta
- [ ] `npx @wasiai/cli` funciona
- [ ] `npm publish --access public` exitoso
