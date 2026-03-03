# SDD-026 — CLI `wasiai invoke` (WAS-13)

**Estado:** DRAFT  
**Fecha:** 2026-03-02  
**HU:** WAS-13 — CLI `wasiai invoke`  
**Package npm:** `@wasiai/cli`  
**Directorio:** `/home/ferdev/.openclaw/workspace/wasiai-cli/`

---

## 1. Context Map — Contrato del Endpoint

### Endpoint consumido
```
POST https://wasiai.vercel.app/api/v1/agents/{slug}/invoke
```

### Request
| Campo | Tipo | Descripción |
|---|---|---|
| Header `X-API-Key` | string (required) | API key del usuario con fondos |
| Body `input` | string (1–2000 chars) | Texto de entrada para el agente |

```json
// Body (JSON)
{ "input": "¿Cuál es el capital de Perú?" }
```

### Response exitosa (200)
La respuesta es proxied desde el canonical endpoint `/api/v1/models/[slug]/invoke`.  
Shape esperado (inferido del canonical):
```json
{ "output": "Lima es la capital de Perú.", "latencyMs": 432 }
```
O puede ser cualquier JSON/text que el agente retorne.

### Errores documentados (leídos en `route.ts`)
| Status | `error` | Condición |
|---|---|---|
| 402 | `payment_required` | Sin API key Y agente sin free_trial |
| 402 | `use_trial_endpoint` | Sin API key Y agente tiene free_trial disponible |
| 502 | `invoke_proxy_error` | Upstream unreachable (timeout 30s) |
| 4xx/5xx | proxied | Errores del canonical endpoint (404 agente no existe, 503 inactivo, etc.) |

### Diferencia con Trial endpoint
El endpoint `/api/v1/agents/{slug}/trial` requiere **autenticación de usuario** (session cookie Supabase).  
El endpoint `/api/v1/agents/{slug}/invoke` usa **API Key stateless** — ideal para CLI.

---

## 2. Diseño del CLI `@wasiai/cli`

### 2.1 Estructura del package

```
wasiai-cli/
├── bin/
│   └── wasiai.js          # Entry point ejecutable (shebang node)
├── src/
│   ├── commands/
│   │   └── invoke.js      # Lógica del comando invoke
│   ├── config.js          # URLs por env, constantes
│   └── output.js          # Formateadores json/text
├── package.json
├── README.md
└── .npmrc                 # access=public
```

### 2.2 Interfaz de usuario

```bash
wasiai invoke <slug> '<input>' [options]

Opciones:
  --key <apikey>           API key (o env WASIAI_API_KEY)
  --format <json|text>     Formato de salida [default: text]
  --env <fuji|mainnet>     Entorno [default: mainnet]
  -h, --help               Muestra ayuda
  -V, --version            Muestra versión
```

### 2.3 URLs por entorno

| env | URL base |
|---|---|
| `mainnet` | `https://wasiai.vercel.app` |
| `fuji` | `https://wasiai.vercel.app` (staging — misma URL por ahora) |

> Nota: Cuando exista URL de staging distinta, actualizar `src/config.js`.

### 2.4 Parsing de args

Usar **`commander`** (más ergonómico que minimist para CLIs con subcomandos).

```js
// bin/wasiai.js
#!/usr/bin/env node
import { program } from 'commander'
import { invokeCommand } from '../src/commands/invoke.js'

program
  .name('wasiai')
  .description('WasiAI CLI — invoke agents from the terminal')
  .version('1.0.0')

program
  .command('invoke <slug> <input>')
  .description('Invoke a WasiAI agent')
  .option('--key <apikey>', 'API key (or WASIAI_API_KEY env var)')
  .option('--format <format>', 'Output format: json | text', 'text')
  .option('--env <env>', 'Environment: fuji | mainnet', 'mainnet')
  .action(invokeCommand)

program.parse()
```

### 2.5 Lógica de invoke (`src/commands/invoke.js`)

```
1. Resolver API key: --key > WASIAI_API_KEY env var
2. Si no hay key → stderr "Error: API key required. Use --key or set WASIAI_API_KEY" → exit 1
3. Construir URL: config.BASE_URLS[env] + /api/v1/agents/{slug}/invoke
4. POST con X-API-Key header y body { input }
5. Si status >= 400 → stderr con JSON del error → exit 1
6. Si --format=json → stdout JSON completo
7. Si --format=text → stdout solo el campo `output` (o raw text si no es JSON)
8. exit 0
```

### 2.6 Output

- **stdout:** resultado de la invocación  
- **stderr:** mensajes de error, advertencias  
- **Exit codes:** 0 = éxito, 1 = error

### 2.7 `package.json` del CLI

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
    "test": "node --test src/**/*.test.js",
    "prepublishOnly": "npm test"
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
  "keywords": ["wasiai", "cli", "ai", "agents", "web3"],
  "license": "MIT"
}
```

---

## 3. Acceptance Criteria Técnicos

| # | AC | Verificación |
|---|---|---|
| AC1 | `wasiai invoke <slug> '<input>' --key <key>` retorna output en stdout, exit 0 | `echo $?` = 0 |
| AC2 | Sin `--key` y sin `WASIAI_API_KEY` → stderr contiene "API key required", exit 1 | `echo $?` = 1 |
| AC3 | `--format json` retorna JSON completo en stdout | `jq .output` funciona |
| AC4 | `--format text` retorna solo el campo `output` (plain text) | Sin caracteres JSON |
| AC5 | Agente inexistente → stderr con error del endpoint, exit 1 | status 404 manejado |
| AC6 | `--env fuji` y `--env mainnet` usan la URL correcta | Configurable en config.js |
| AC7 | `npx @wasiai/cli invoke` funciona sin instalación global | npx funciona |
| AC8 | `npm publish --access public` publica en registro npm | Verificar con `npm info @wasiai/cli` |

---

## 4. Constraint Directives

### OBLIGATORIO
- `"type": "module"` en package.json del CLI (ESM puro, no CommonJS)
- Shebang `#!/usr/bin/env node` en `bin/wasiai.js`
- API key NUNCA en logs ni stdout — solo en headers HTTP
- Timeout de 35s en fetch (mayor que el 30s del servidor para dar margen)
- Manejar `SIGINT` / `SIGTERM` limpiamente (no stacktrace al Ctrl+C)
- Node ≥ 18 (fetch nativo, sin `node-fetch`)

### PROHIBIDO
- NO instalar `axios`, `node-fetch` u otras libs HTTP (usar `fetch` nativo Node 18+)
- NO usar dependencias del repo `wasiai-v2` (es un package independiente)
- NO leer archivos de configuración del sistema (`.env` del repo wasiai-v2)
- NO hardcodear API keys en ningún archivo
- NO CommonJS (`require()`) — usar ESM (`import`)

---

## 5. Implementation Readiness Check

- [x] Contrato del endpoint leído en código real (route.ts)
- [x] Error codes documentados
- [x] Diferencia invoke vs trial clara
- [x] Node 18+ fetch nativo — sin dependencias HTTP extra
- [x] Nombre npm `@wasiai/cli` confirmado disponible
- [x] Estructura de archivos definida
- [x] Story File a generar en siguiente paso
