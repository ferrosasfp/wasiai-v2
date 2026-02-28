# SDD — HU-7.5: Ejemplo End-to-End x402 con @wasiai/sdk

**Artefacto:** S1 (Architect — BMAD v6)  
**Fecha:** 2026-02-28  
**Autor:** San (S1 Agent)  
**Estado:** DRAFT — pendiente SPEC_APPROVED de Fer  
**Épica:** E7 — Integraciones  
**Prerequisito:** HU_APPROVED de Fer (verificado)

---

## 1. Resumen del Sistema

Este SDD especifica la estructura, código y contenido del repo ejemplo oficial `wasiai-x402-example`. Es un repo independiente, público, cloneable por cualquier developer externo. No modifica `wasiai-v2`. Su única función: demostrar en ≤15 minutos cómo consumir y publicar agentes en WasiAI usando exclusivamente `@wasiai/sdk`.

**Contexto técnico confirmado:**
- `@wasiai/sdk` v0.1.0 autentica con `X-API-Key` (no firma ERC-3009 directa)
- El flujo x402/ERC-3009 ocurre **server-side en WasiAI** — el developer no firma on-chain
- Interfaz: `new WasiAI({ apiKey }) → client.invoke(slug, input) → { output, tx_hash }`
- El developer obtiene su API key desde el dashboard de WasiAI
- El pago queda evidenciado en `tx_hash` del response

---

## 2. Estructura de Archivos

```
wasiai-x402-example/          ← repo independiente (NO dentro de wasiai-v2)
├── src/
│   └── invoke.ts             ← entry point principal
├── .env.example              ← variables requeridas (sin valores reales)
├── .env                      ← en .gitignore — nunca en git
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

### Rationale de estructura

- Un solo archivo fuente (`invoke.ts`) — máxima legibilidad para un developer nuevo
- Sin subdirectorios innecesarios — es un ejemplo, no una app
- `src/` para que TypeScript compile limpio con `outDir: dist`
- Repo raíz limpio: solo los archivos que un dev necesita ver

---

## 3. Código Completo — `src/invoke.ts`

```typescript
/**
 * WasiAI x402 Example — invoke.ts
 *
 * Demuestra cómo invocar un agente del marketplace WasiAI
 * y pagar automáticamente vía protocolo x402 (USDC en Avalanche Fuji).
 *
 * Prerequisitos:
 *   - Node.js 18+
 *   - npm install
 *   - Copiar .env.example → .env y completar las variables
 *
 * Uso:
 *   npm run invoke
 */

import 'dotenv/config'
import { WasiAI, InsufficientBudgetError, AgentNotFoundError, RateLimitError } from '@wasiai/sdk'

// ─── Validación de entorno ────────────────────────────────────────────────────

const WASIAI_API_KEY = process.env.WASIAI_API_KEY?.trim()
const AGENT_SLUG     = process.env.AGENT_SLUG?.trim()     ?? 'summarizer'
const AGENT_INPUT    = process.env.AGENT_INPUT?.trim()    ?? 'Explain what WasiAI is in one paragraph.'

if (!WASIAI_API_KEY) {
  console.error('❌ ERROR: WASIAI_API_KEY no está definida en .env')
  console.error('   Obtén tu API key en: https://wasiai-v2.vercel.app/dashboard/keys')
  process.exit(1)
}

// ─── Inicialización del SDK ───────────────────────────────────────────────────

const client = new WasiAI({
  apiKey: WASIAI_API_KEY,
})

// ─── Invocación ───────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 WasiAI x402 Example')
  console.log('─'.repeat(50))
  console.log(`   Agente : ${AGENT_SLUG}`)
  console.log(`   Input  : ${AGENT_INPUT}`)
  console.log('─'.repeat(50))

  try {
    console.log('\n⏳ Invocando agente...\n')

    const result = await client.invoke(AGENT_SLUG, AGENT_INPUT)

    console.log('✅ Invocación exitosa')
    console.log('─'.repeat(50))
    console.log('\n📤 Output del agente:')
    console.log(result.output)
    console.log('\n💳 Transacción on-chain:')
    console.log(`   tx_hash : ${result.tx_hash}`)
    console.log(`   Explorer: https://testnet.snowtrace.io/tx/${result.tx_hash}`)
    console.log('─'.repeat(50))
    console.log('\n✔ Listo. El pago fue procesado automáticamente vía x402.\n')

  } catch (err) {
    handleError(err)
    process.exit(1)
  }
}

// ─── Manejo de errores ────────────────────────────────────────────────────────

function handleError(err: unknown): void {
  console.error('\n❌ Error al invocar el agente:')

  if (err instanceof InsufficientBudgetError) {
    console.error('   Causa : Saldo insuficiente en tu cuenta WasiAI.')
    console.error('   Acción: Recarga USDC de testnet en tu dashboard.')
    console.error('   Faucet USDC Fuji: https://faucet.circle.com')
    console.error(`   Dashboard: https://wasiai-v2.vercel.app/dashboard`)
    return
  }

  if (err instanceof AgentNotFoundError) {
    console.error(`   Causa : El agente "${AGENT_SLUG}" no existe o no está activo.`)
    console.error('   Acción: Verifica el slug en el marketplace.')
    console.error('   Marketplace: https://wasiai-v2.vercel.app')
    return
  }

  if (err instanceof RateLimitError) {
    console.error('   Causa : Demasiadas solicitudes en poco tiempo.')
    console.error('   Acción: Espera unos segundos e intenta de nuevo.')
    return
  }

  // Error desconocido — mostrar mensaje sin stack trace completo
  if (err instanceof Error) {
    console.error(`   Causa : ${err.message}`)
  } else {
    console.error('   Causa : Error desconocido.')
  }

  console.error('\n   Si el problema persiste: https://github.com/ferrosasfp/wasiai-x402-example/issues')
}

// ─── Entry point ─────────────────────────────────────────────────────────────

main()
```

**Notas del código:**
- Sin `any` explícito
- Sin `ethers.js`
- Sin addresses hardcodeadas
- `trim()` en todas las env vars
- `process.exit(1)` en cualquier error — exit code != 0 verificable por CI
- Errores tipados (`InsufficientBudgetError`, `AgentNotFoundError`, `RateLimitError`) asumen que el SDK los exporta; si no, ver sección 7.1

---

## 4. Archivo `.env.example`

```dotenv
# WasiAI x402 Example — Variables de entorno
# Copia este archivo: cp .env.example .env
# ⚠️  NUNCA commits .env — está en .gitignore

# API Key de WasiAI (requerida)
# Obtén la tuya en: https://wasiai-v2.vercel.app/dashboard/keys
WASIAI_API_KEY=wai_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Slug del agente a invocar (opcional — default: summarizer)
# Encuentra slugs en el marketplace: https://wasiai-v2.vercel.app
AGENT_SLUG=summarizer

# Input que enviarás al agente (opcional — hay un default en el script)
AGENT_INPUT=Explain what WasiAI is in one paragraph.
```

**Decisiones:**
- Solo 3 variables — mínimo absoluto que cumple todos los ACs
- `WASIAI_API_KEY` es la única requerida (`process.exit(1)` si falta)
- `AGENT_SLUG` y `AGENT_INPUT` tienen defaults en código para reducir fricción
- Sin `PRIVATE_KEY`, sin `CONTRACT_ADDRESS` — el SDK abstrae todo eso (el flujo x402 es server-side)
- Prefijo `wai_` en el ejemplo es ilustrativo del formato real de API keys

---

## 5. Estructura del `README.md`

El README sigue este esquema (contenido completo abajo):

```
# wasiai-x402-example

Badges: Node.js >=18 | npm | Fuji testnet

Descripción una línea: "Hello World oficial de integración con WasiAI."

## ¿Qué hace este ejemplo?
## Prerequisitos
## Paso 1: Configura tu entorno
  ### 1.1 Obtén tu API key de WasiAI
  ### 1.2 Obtén USDC de testnet
  ### 1.3 Configura .env
## Paso 2: Invoca un agente
  ### Qué verás en consola
## Paso 3: Publica tu propio agente
  ### 3.1 Registra tu agente vía dashboard
  ### 3.2 Registra tu agente vía SDK (programático)
  ### 3.3 Qué sucede después
## Manejo de errores
## Estructura del proyecto
## Links útiles
## Licencia
```

### Contenido clave por sección

#### ¿Qué hace este ejemplo?

> Este repo demuestra el flujo completo de integración con [WasiAI](https://wasiai-v2.vercel.app):
> 1. Autenticarse con una API key
> 2. Invocar un agente del marketplace
> 3. Pagar automáticamente en USDC vía protocolo x402 (Avalanche Fuji testnet)
> 4. Recibir el output del agente y el hash de la transacción on-chain
>
> No necesitas manejar wallets, firmar transacciones ni interactuar con contratos directamente — el SDK lo hace todo.

#### Prerequisitos

- Node.js ≥ 18 ([descargar](https://nodejs.org))
- npm ≥ 9
- Una cuenta en [WasiAI](https://wasiai-v2.vercel.app)

#### Paso 1.1 — Obtén tu API key

1. Ve a [wasiai-v2.vercel.app/dashboard/keys](https://wasiai-v2.vercel.app/dashboard/keys)
2. Haz clic en "Crear API key"
3. Copia el valor — solo se muestra una vez
4. Pégalo en `.env` como `WASIAI_API_KEY`

#### Paso 1.2 — Obtén USDC de testnet

WasiAI en Fuji testnet usa USDC de testnet (sin valor real). Puedes obtenerlo gratis:

- **Faucet principal:** https://faucet.circle.com (selecciona Avalanche Fuji)
- **Faucet alternativo:** https://core.app/tools/testnet-faucet/

> El precio por llamada al agente `summarizer` es ~$0.01 USDC testnet.

#### Paso 1.3 — Configura `.env`

```bash
cp .env.example .env
# Edita .env y completa WASIAI_API_KEY
```

#### Paso 2 — Invoca un agente

```bash
npm install
npm run invoke
```

#### Qué verás en consola (ejemplo de output exitoso)

```
🚀 WasiAI x402 Example
──────────────────────────────────────────────────
   Agente : summarizer
   Input  : Explain what WasiAI is in one paragraph.
──────────────────────────────────────────────────

⏳ Invocando agente...

✅ Invocación exitosa
──────────────────────────────────────────────────

📤 Output del agente:
WasiAI is an on-chain AI agent marketplace on Avalanche...

💳 Transacción on-chain:
   tx_hash : 0xabc123...
   Explorer: https://testnet.snowtrace.io/tx/0xabc123...
──────────────────────────────────────────────────

✔ Listo. El pago fue procesado automáticamente vía x402.
```

---

## 6. Sección "Publica tu agente" (AC-5)

Esta sección va dentro del README como "Paso 3". El flujo es **dashboard-first** (más simple) con opción programática.

### Paso 3.1 — Registra tu agente vía dashboard

1. Ve a [wasiai-v2.vercel.app/creator](https://wasiai-v2.vercel.app/creator)
2. Haz clic en "Nuevo agente"
3. Completa:
   - **Slug único** (ej. `mi-agente-v1`) — identificador permanente
   - **Nombre y descripción** — visible en el marketplace
   - **Endpoint** — URL pública que recibirá los inputs (`POST`, cuerpo JSON)
   - **Precio por llamada** — en USDC (ej. `0.01`)
4. Guarda y activa el agente — aparece en el marketplace inmediatamente

**Formato del endpoint:**
Tu servidor debe aceptar `POST` con `Content-Type: application/json`:
```json
// Request (WasiAI → tu servidor)
{ "input": "string con el input del consumer" }

// Response esperado
{ "output": "string con el resultado" }
```

### Paso 3.2 — Registra tu agente vía SDK (programático)

```typescript
import 'dotenv/config'
import { WasiAI } from '@wasiai/sdk'

const client = new WasiAI({ apiKey: process.env.WASIAI_API_KEY! })

const agent = await client.agents.register({
  slug: 'mi-agente-v1',
  name: 'Mi Agente',
  description: 'Hace algo útil',
  endpoint: 'https://mi-servidor.com/api/invoke',
  priceUsdc: '0.01',
})

console.log('Agente registrado:', agent.slug)
```

> **Nota:** El método `client.agents.register()` asume que el SDK lo expone en v0.1.0+. Si no está disponible, usa el dashboard (Paso 3.1) mientras se actualiza el SDK.

### Paso 3.3 — Qué sucede después

- Cada invocación de tu agente genera un pago automático en USDC
- **Tu recorte:** 90% por llamada
- **Fee WasiAI:** 10%
- El saldo acumula en tu dashboard y puedes retirarlo cuando quieras desde [/creator](https://wasiai-v2.vercel.app/creator)
- Cada llamada queda registrada on-chain en Fuji — auditable en [Snowtrace](https://testnet.snowtrace.io)

---

## 7. Manejo de Errores — Especificación Completa

### 7.1 Errores del SDK esperados

El código asume que `@wasiai/sdk` exporta estas clases de error. **Antes de implementar, verificar en `node_modules/@wasiai/sdk/dist/index.d.ts` o en el README del SDK.**

| Error | Código HTTP equivalente | Cuándo ocurre | Mensaje en consola |
|-------|------------------------|---------------|--------------------|
| `InsufficientBudgetError` | 402 | Saldo USDC insuficiente en la cuenta | Instrucciones para recargar + link al faucet |
| `AgentNotFoundError` | 404 | Slug no existe o agente inactivo | Instrucciones para verificar en marketplace |
| `RateLimitError` | 429 | Demasiadas llamadas en poco tiempo | Mensaje de espera |
| `Error` (genérico) | 5xx / red | Error inesperado del servidor o red | `err.message` limpio, sin stack trace |

### 7.2 Fallback si el SDK no exporta los errores tipados

Si la verificación del SDK muestra que no exporta estas clases, el código alternativo es:

```typescript
} catch (err) {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('insufficient') || msg.includes('budget') || msg.includes('402')) {
      // InsufficientBudgetError
    } else if (msg.includes('not found') || msg.includes('404')) {
      // AgentNotFoundError
    } else if (msg.includes('rate limit') || msg.includes('429')) {
      // RateLimitError
    } else {
      console.error(`   Causa: ${err.message}`)
    }
  }
  process.exit(1)
}
```

**Esta es la única ambigüedad técnica de la HU.** Ver Implementation Readiness Check, ítem IRC-2.

---

## 8. `package.json` — Especificación Completa

```json
{
  "name": "wasiai-x402-example",
  "version": "1.0.0",
  "description": "Hello World oficial de integración con WasiAI marketplace",
  "main": "dist/invoke.js",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "invoke": "npx tsx src/invoke.ts",
    "build": "tsc",
    "start": "node dist/invoke.js"
  },
  "dependencies": {
    "@wasiai/sdk": "^0.1.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "@types/node": "^18.0.0"
  },
  "license": "MIT"
}
```

**Notas:**
- `tsx` como devDependency — permite `npm run invoke` sin compilar explícitamente
- `dotenv` v16+ — compatible con `import 'dotenv/config'` en ESM/CJS
- Sin ethers.js, sin viem, sin LangChain, sin AgentKit

---

## 9. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 10. `.gitignore`

```gitignore
node_modules/
dist/
.env
*.log
```

**Crítico:** `.env` en `.gitignore` — AC-4 explícito.

---

## 11. Definition of Done (DoD) — Verificable

Cada ítem es verificable objetivamente antes de hacer el repo público.

- [ ] **DoD-1** `npm install && npm run invoke` corre sin errores en una máquina limpia con Node.js 18 y variables `.env` correctas
- [ ] **DoD-2** El output muestra: input, output del agente, `tx_hash`, link al explorer
- [ ] **DoD-3** Con `WASIAI_API_KEY` inválida → mensaje de error claro, `exit code 1`
- [ ] **DoD-4** Con agente slug inexistente → mensaje de error claro, `exit code 1`
- [ ] **DoD-5** Cero ocurrencias de `ethers` en `node_modules/@wasiai/sdk` (verificar con `grep -r "ethers" node_modules/@wasiai/sdk/dist/` → sin resultados críticos)
- [ ] **DoD-6** `grep -r "PRIVATE_KEY\|privateKey\|0x71Cdd\|0x5425890" src/` → 0 resultados
- [ ] **DoD-7** `.env` está en `.gitignore` — `git check-ignore .env` → `.env`
- [ ] **DoD-8** `package.json` tiene `"node": ">=18"` en `engines`
- [ ] **DoD-9** `@wasiai/sdk` y `dotenv` son las ÚNICAS dependencias en `dependencies` (no `devDependencies`)
- [ ] **DoD-10** README walkthrough completado por Fer — puede seguirlo sin preguntar nada
- [ ] **DoD-11** Sección "Publica tu agente" tiene instrucciones completas de dashboard + SDK
- [ ] **DoD-12** Repo creado en GitHub bajo `ferrosasfp/wasiai-x402-example`, visibility: public (hacerlo público solo después del code review de Fer)

---

## 12. Implementation Readiness Check (IRC)

Ejecutado formalmente por S1 antes de emitir este SDD.

| ID | Pregunta | Estado | Detalle |
|----|----------|--------|---------|
| IRC-1 | ¿`@wasiai/sdk` v0.1.0 está disponible en npm? | ✅ Confirmado | Señalado en contexto técnico de la HU |
| IRC-2 | ¿El SDK exporta `InsufficientBudgetError`, `AgentNotFoundError`, `RateLimitError`? | ⚠️ Pendiente verificación | El Dev debe revisar `index.d.ts` del SDK al iniciar. Si no existen, usar fallback de sección 7.2. No es blocker — el fallback está especificado. |
| IRC-3 | ¿El SDK expone `client.invoke(slug, input)`? | ✅ Confirmado | Especificado en contexto técnico verificado por San |
| IRC-4 | ¿El SDK expone `client.agents.register()`? | ⚠️ Pendiente verificación | Si no existe en v0.1.0, la sección 3.2 del README indica "usar dashboard". No es blocker — el AC-5 acepta documentación. |
| IRC-5 | ¿El agente `summarizer` existe y está activo en Fuji? | ⚠️ Verificar antes de dev | El Dev verifica en marketplace antes de codear. Si no existe, usar cualquier agente activo y documentarlo. |
| IRC-6 | ¿Los ACs son verificables sin ambigüedad? | ✅ Sí | DoD-1 a DoD-12 son objetivos y ejecutables en CLI |
| IRC-7 | ¿Hay dependencias bloqueantes sin resolver? | ✅ No | IRC-2, IRC-4, IRC-5 tienen fallbacks claros |
| IRC-8 | ¿El scope está acotado y el Dev puede implementarlo sin preguntar? | ✅ Sí | Un archivo fuente, estructura simple, código completo en este SDD |
| IRC-9 | ¿El repo es independiente de wasiai-v2? | ✅ Sí | Repo nuevo `wasiai-x402-example` — no toca el monorepo |
| IRC-10 | ¿La implementación sigue Golden Path? | ✅ Sí | Sin ethers.js, sin hardcodes, Node.js 18+, solo @wasiai/sdk + dotenv |

**Veredicto IRC:** ✅ IMPLEMENTABLE — Los 3 ítems pendientes tienen fallbacks especificados y no son blockers.

---

## 13. Notas para el Dev (SM → story file)

Al crear el story file desde este SDD, el SM debe incluir:

1. **Verificación inicial obligatoria** (antes de escribir código):
   ```bash
   npm pack @wasiai/sdk  # o instalar y revisar index.d.ts
   ```
   Confirmar: ¿exporta los 3 tipos de error? ¿exporta `client.agents.register()`?
   Documentar hallazgo en el story file antes de continuar.

2. **Orden de implementación:**
   1. Crear repo `wasiai-x402-example` en GitHub (privado primero)
   2. Estructura de archivos según sección 2
   3. `package.json`, `tsconfig.json`, `.gitignore`
   4. `.env.example`
   5. `src/invoke.ts` (código completo en sección 3)
   6. Ajustar error handling según resultado IRC-2
   7. `README.md` siguiendo esquema de sección 5
   8. Test completo del DoD (sección 11)
   9. Code review de Fer
   10. Hacer repo público

3. **No modificar wasiai-v2** — ningún archivo del monorepo cambia con esta HU.

---

## 14. Links de Referencia

- Dashboard API keys: https://wasiai-v2.vercel.app/dashboard/keys
- Marketplace: https://wasiai-v2.vercel.app
- Creator dashboard: https://wasiai-v2.vercel.app/creator
- Contrato Fuji: `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53`
- Explorer Fuji: https://testnet.snowtrace.io
- Faucet USDC Fuji: https://faucet.circle.com
- Faucet AVAX Fuji: https://core.app/tools/testnet-faucet/

---

*SDD generado por San (S1) — 2026-02-28*  
*Próximo gate requerido: SPEC_APPROVED de Fer*
