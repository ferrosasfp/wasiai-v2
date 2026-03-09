# NEXUS-AUDIT-SOLUTIONS v1.0
## @wasiai/sdk — Solutions Guide

**Fecha:** 2026-03-08
**Companion de:** `NEXUS-AUDIT-REPORT.md` v1.0 (10 hallazgos)
**Instrucciones:** Codigo sugerido listo para implementar. El equipo aplica los fixes.

---

## SDK-01 (MEDIUM) — Validar baseUrl contra SSRF

**Archivos:** `src/invoke.ts`, `src/discover.ts`, `src/publish.ts`, `src/stats.ts`

Crear un helper compartido que valide y normalice baseUrl:

```typescript
// src/utils/validateBaseUrl.ts (NUEVO)
export function validateAndNormalizeBaseUrl(baseUrl?: string): string {
  const url = (baseUrl ?? 'https://wasiai-v2.vercel.app').replace(/\/$/, '')

  // En entornos server-side, rechazar URLs no-HTTPS y rangos privados
  if (typeof window === 'undefined') {  // Node.js / server-side
    if (!url.startsWith('https://') && !url.startsWith('http://localhost')) {
      throw new Error(
        `[WasiAI SDK] Invalid baseUrl: "${url}". ` +
        `Only HTTPS URLs are allowed in server-side environments.`
      )
    }
    // Bloquear rangos de IP privadas conocidas
    const BLOCKED_PATTERNS = [
      /169\.254\./,           // AWS/GCP metadata
      /100\.64\./,            // Carrier-grade NAT
      /^https?:\/\/10\./,     // RFC 1918
      /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./,  // RFC 1918
      /^https?:\/\/192\.168\./,  // RFC 1918
    ]
    if (BLOCKED_PATTERNS.some(p => p.test(url))) {
      throw new Error(`[WasiAI SDK] Blocked baseUrl: "${url}". Private IP ranges are not allowed.`)
    }
  }

  return url
}
```

Usar en todos los modulos:
```typescript
// invoke.ts:23 — ANTES
const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
// DESPUES
import { validateAndNormalizeBaseUrl } from './utils/validateBaseUrl.js'
const base = validateAndNormalizeBaseUrl(opts.baseUrl)
```

---

## SDK-02 (MEDIUM) — Warning/error si baseUrl es HTTP y hay apiKey

**Archivos:** `src/invoke.ts`, `src/publish.ts`, `src/stats.ts`, `src/langchain/WasiAITool.ts`

Agregar en el helper `validateAndNormalizeBaseUrl` (o inline):

```typescript
// En validateAndNormalizeBaseUrl, antes de retornar:
if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
  console.warn(
    '[WasiAI SDK] WARNING: Using HTTP (non-HTTPS) baseUrl. ' +
    'Your API key will be transmitted in plaintext. ' +
    'Use HTTPS in production.'
  )
  // En produccion, lanzar error en lugar de warning:
  // throw new Error('[WasiAI SDK] API keys must not be sent over HTTP in production.')
}
```

---

## SDK-03 (LOW) — Sanitizar slug para prevenir path traversal

**Archivos:** `src/invoke.ts:24`, `src/langchain/WasiAITool.ts:33`

```typescript
// src/utils/validateSlug.ts (NUEVO)
export function validateSlug(slug: string): string {
  if (!slug || typeof slug !== 'string') {
    throw new Error('[WasiAI SDK] slug is required and must be a string')
  }
  // Solo alfanumerico, guiones y puntos — sin /, .., %
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_.]{0,79}$/.test(slug)) {
    throw new Error(
      `[WasiAI SDK] Invalid slug: "${slug}". ` +
      `Slugs must be alphanumeric with hyphens/underscores, max 80 chars.`
    )
  }
  return slug
}
```

```typescript
// invoke.ts:23-24 — ANTES
const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
const url  = `${base}/api/v1/models/${opts.slug}/invoke`

// DESPUES
import { validateSlug } from './utils/validateSlug.js'
const base = validateAndNormalizeBaseUrl(opts.baseUrl)
const slug = validateSlug(opts.slug)
const url  = `${base}/api/v1/models/${slug}/invoke`
```

---

## SDK-04 (LOW) — Eliminar DEFAULT_BASE_URL duplicado en WasiAITool.ts

**Archivo:** `src/langchain/WasiAITool.ts:5`

```typescript
// ANTES
const DEFAULT_BASE_URL = 'https://wasiai-v2.vercel.app'  // duplicado

// DESPUES — importar de invoke.ts (fuente canonica)
import { DEFAULT_BASE_URL } from '../invoke.js'
// Eliminar la linea const DEFAULT_BASE_URL = ...
```

---

## SDK-05 (LOW) — Limite de tamano en respuesta

**Archivos:** `src/invoke.ts`, `src/discover.ts`, `src/publish.ts`, `src/stats.ts`

```typescript
// src/utils/safeFetchJson.ts (NUEVO)
const MAX_RESPONSE_BYTES = 1024 * 1024  // 1 MB

export async function safeFetchJson<T>(res: Response): Promise<T> {
  const contentLength = res.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
    throw new Error(
      `[WasiAI SDK] Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_BYTES})`
    )
  }
  const text = await res.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`[WasiAI SDK] Response body too large (max ${MAX_RESPONSE_BYTES} bytes)`)
  }
  return JSON.parse(text) as T
}
```

```typescript
// invoke.ts:45 — ANTES
const data = await res.json() as Record<string, unknown>
// DESPUES
import { safeFetchJson } from './utils/safeFetchJson.js'
const data = await safeFetchJson<Record<string, unknown>>(res)
```

---

## SDK-06 (LOW) — Soporte --input-file para CLI seguro en CI/CD

**Archivo:** `src/cli/index.ts:43`

```typescript
// cli/index.ts — agregar opcion --input-file
program
  .command('invoke')
  // ... opciones existentes ...
  .option('-f, --input-file <path>', 'Read input from file instead of --input flag (safer for CI/CD)')
  .action(async (opts) => {
    // Resolver input: --input-file tiene precedencia sobre --input
    let input = opts.input
    if (opts.inputFile) {
      const { readFileSync } = await import('node:fs')
      try {
        input = readFileSync(opts.inputFile, 'utf-8').trim()
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m Cannot read input file: ${opts.inputFile}`)
        process.exit(1)
      }
    }
    if (!input) {
      console.error('\x1b[31mError:\x1b[0m --input or --input-file is required')
      process.exit(1)
    }
    // ... resto del action con `input`
  })
```

Documentar en README:
```markdown
### Seguridad en CI/CD

Para evitar exponer datos sensibles en logs de CI/CD, usa `--input-file`:

```bash
# En lugar de (expuesto en logs):
wasiai invoke --agent my-agent --input "datos sensibles"

# Usa (seguro):
echo "datos sensibles" > /tmp/input.txt
wasiai invoke --agent my-agent --input-file /tmp/input.txt
rm /tmp/input.txt
```
```

---

## SDK-07 (INFO) — Eliminar URL hardcodeada en WasiAIPaymentError

**Archivo:** `src/langchain/errors.ts:3`

```typescript
// ANTES
export class WasiAIPaymentError extends Error {
  constructor(public slug: string) {
    super(`Payment required for agent "${slug}". Fund your API key at wasiai-v2.vercel.app`)
  }
}

// DESPUES — URL configurable o eliminar de error message
export class WasiAIPaymentError extends Error {
  constructor(
    public slug: string,
    public dashboardUrl = 'https://wasiai.ai',  // custom domain cuando este disponible
  ) {
    super(`Payment required for agent "${slug}". Fund your API key at ${dashboardUrl}`)
  }
}
```

O mas simple — eliminar la URL del mensaje de error y dejar que la documentacion la provea:
```typescript
super(`Payment required for agent "${slug}". Insufficient credits in your API key.`)
```

---

## SDK-08 (INFO) — Documentar limite de input recomendado

**Archivos:** `src/invoke.ts`, `src/langchain/WasiAITool.ts`

Agregar JSDoc con limite recomendado:

```typescript
// invoke.ts — JSDoc actualizado
/**
 * Invoke a WasiAI agent.
 *
 * @param opts.input - Input text for the agent. Recommended max: 32KB.
 *   Larger inputs may cause timeouts or server errors depending on the agent.
 *   Use streaming for large documents (when supported).
 */
export async function invokeAgent(opts: InvokeOptions): Promise<InvokeResult> {
```

Si se quiere enforcement:
```typescript
// invoke.ts:22 — agregar al inicio de invokeAgent
const MAX_INPUT_BYTES = 32 * 1024  // 32 KB
if (Buffer.byteLength(opts.input, 'utf-8') > MAX_INPUT_BYTES) {
  console.warn(`[WasiAI SDK] Input is ${Buffer.byteLength(opts.input)} bytes. Consider chunking for inputs > 32KB.`)
}
```

---

## SDK-09 (INFO) — Validar endpoint URL en publishAgent

**Archivo:** `src/publish.ts:38`

```typescript
// publish.ts — agregar antes del fetch
function isValidEndpointUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost'
  } catch {
    return false
  }
}

export async function publishAgent(opts: PublishOptions): Promise<PublishResult> {
  if (!isValidEndpointUrl(opts.endpoint)) {
    throw new Error(
      `[WasiAI SDK] Invalid endpoint URL: "${opts.endpoint}". ` +
      `Must be a valid HTTPS URL (e.g., https://api.example.com/agent).`
    )
  }
  // ... fetch existente
}
```

---

## SDK-10 (INFO) — Opcion quiet para stats en CI/CD

**Archivo:** `src/cli/index.ts:266-270`

```typescript
// Agregar flag --quiet al subcommand stats
program
  .command('stats')
  .option('-q, --quiet', 'Suppress revenue output (for CI/CD environments)')
  .action(async (opts) => {
    // ...
    if (!opts.quiet) {
      console.log(`   Revenue:  $${stats.total_revenue.toFixed(2)} USDC`)
    } else {
      console.log(`   Revenue:  [hidden — use --output json for machine-readable output]`)
    }
  })
```

---

*Generado por NexusAudit v2.0 (adaptado) + NexusGuard v1.0 | WasiAI Security Framework | 2026-03-08*
