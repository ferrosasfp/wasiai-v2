# SDD-031 — Pre-deploy Checklist + Env Validation

**HU:** WAS-119  
**NNN:** 031 / 2 SP / P0  
**Estado:** SDD  
**Fecha:** 2026-03-03  

---

## Contexto

WasiAI v2 (producción, pagos reales, modo QUALITY) carece de un mecanismo formal para verificar que todas las variables de entorno requeridas estén presentes antes del deploy. Deploys sin vars críticas causan fallos silenciosos o errores en producción con usuarios reales.

---

## Decisiones de diseño

### D1 — Fuente de verdad: `.env.example`

`.env.example` es el **contrato público de vars obligatorias**. El script `validate-env.js` lee los keys de ese archivo (no de `.env.local`) y verifica que cada key exista en el entorno de ejecución.

Ventaja: `.env.example` es versionado en git y visible en PRs. Cualquier var nueva que se agregue ahí automáticamente queda validada en deploy.

### D2 — Clasificación de variables

El script diferencia vars `REQUIRED` (rompe en runtime si falta) de `OPTIONAL` (tiene default o es feature flag). Las REQUIRED causan exit code 1; las OPTIONAL emiten warnings.

#### REQUIRED — 10 vars (rompen en runtime si faltan)

| Variable | Servicio | Motivo |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | URL de la DB — toda la app depende de esto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Auth client-side |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Operaciones server-side privilegiadas |
| `OPERATOR_PRIVATE_KEY` | Blockchain | Firma transacciones de pago — sin esto, x402 muere |
| `UPSTASH_REDIS_REST_URL` | Redis/Upstash | Rate limiting — sin esto, los endpoints quedan abiertos |
| `UPSTASH_REDIS_REST_TOKEN` | Redis/Upstash | Auth de Redis |
| `PINATA_JWT` | Pinata/IPFS | Storage de modelos/agentes |
| `CRON_SECRET` | Cron | Protege `/api/cron/*` contra invocación no autorizada |
| `WASIAI_SYSTEM_CREATOR_ID` | Sistema | ID del creator sistema — integridad del marketplace |
| `AGENT_WALLET_ENCRYPTION_KEY` | Agent Wallets | Cifrado de private keys de agentes (WAS-71) — 32 bytes hex |

#### OPTIONAL — 20 vars (tienen default o son feature flags)

| Variable | Default / Nota |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://wasiai-v2.vercel.app` |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `en` |
| `NEXT_PUBLIC_CHAIN_ID` | `43113` (Fuji testnet) |
| `NEXT_PUBLIC_RPC_TESTNET` | `https://api.avax-test.network/ext/bc/C/rpc` |
| `NEXT_PUBLIC_RPC_MAINNET` | `https://api.avax.network/ext/bc/C/rpc` |
| `NEXT_PUBLIC_DEFAULT_NETWORK` | `fuji` |
| `MARKETPLACE_CONTRACT_ADDRESS` | Requerida para operaciones onchain; sin ella el contrato no funciona |
| `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` | Dirección del contrato en Fuji |
| `NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET` | Dirección del contrato en mainnet |
| `NEXT_PUBLIC_OPERATOR_ADDRESS` | Derivada del OPERATOR_PRIVATE_KEY en runtime |
| `WASIAI_TREASURY_ADDRESS` | Configurada en contrato; warning si falta |
| `NEXT_PUBLIC_WASIAI_TREASURY` | Frontend treasury display |
| `X402_FACILITATOR_URL` | `https://facilitator.ultravioletadao.xyz` |
| `NEXT_PUBLIC_PINATA_GATEWAY` | `https://gateway.pinata.cloud/ipfs` |
| `GROQ_API_KEY` | Feature: agentes demo — desactivados si falta |
| `OPEN_REGISTRATION_KEY` | Feature flag: registro abierto |
| `SENTRY_DSN` | Error tracking — warning si falta en prod |
| `SENTRY_ORG` | Sentry config |
| `SENTRY_PROJECT` | Sentry config |
| `SENTRY_AUTH_TOKEN` | Sentry source maps upload |

**Total en contrato `.env.example`: 30 vars (10 REQUIRED + 20 OPTIONAL)**

> Nota: `.env.local` contiene vars adicionales no en `.env.example` (AI_PROVIDERS, CDP_API_KEY_*, LINEAR_API_KEY, SUPABASE_PAT, etc.) — esas son vars de desarrollo local, no parte del contrato de deploy.

### D3 — Script: `scripts/validate-env.js`

- **Runtime:** Node.js puro — sin dependencias externas
- **Módulo:** CommonJS (el proyecto tiene `"type": "commonjs"` en package.json)
- **Fuente de keys:** Lee y parsea `.env.example` en runtime
- **Fuente de valores:** `process.env` (en Vercel/CI) o `.env.local` cargado manualmente si se corre local
- **Exit codes:** `0` = OK, `1` = una o más REQUIRED ausentes
- **Output:** Coloreado con ANSI, tabla de resultados, resumen final

#### Estructura del script

```
validate-env.js
├── parseEnvExample(filePath)     → string[] — extrae keys de .env.example
├── REQUIRED_VARS                 → Set<string> — hardcoded (10 vars)
├── checkEnv(keys)                → { missing: [], warnings: [], ok: [] }
├── printReport(result)           → void — tabla coloreada en stdout
└── main()                        → process.exit(0|1)
```

---

## Estructura de archivos

```
wasiai-v2/
├── scripts/
│   └── validate-env.js          ← NUEVO — validador de env vars
├── doc/
│   └── deploy-checklist.md      ← NUEVO — checklist humano pre-deploy
├── .env.example                  ← EXISTENTE — actualizar con SENTRY_* y AGENT_WALLET_ENCRYPTION_KEY
└── package.json                  ← MODIFICAR — agregar script "validate:env"
```

---

## Constraint Directives

### OBLIGATORIO
- El script DEBE leer las keys desde `.env.example` (no hardcodear la lista completa)
- Las 10 REQUIRED_VARS SÍ se hardcodean en el script para diferenciar REQUIRED vs OPTIONAL
- Exit code 1 si alguna REQUIRED falta
- El script NO debe requerir `dotenv` ni ningún paquete npm
- `.env.example` NUNCA debe contener valores reales (solo keys vacías o defaults públicos)

### PROHIBIDO
- `require('dotenv')` en el script de validación
- Leer `.env.local` directamente en el script (el env ya debe estar en `process.env` en CI/Vercel)
- Hacer `console.log` de los valores de las vars (solo confirmar presencia)
- Agregar vars con prefijo `NEXT_PUBLIC_` a REQUIRED_VARS si tienen defaults razonables

---

## DoD (Definition of Done)

- [ ] `scripts/validate-env.js` existe y pasa `node scripts/validate-env.js` con env completo
- [ ] `npm run validate:env` disponible en package.json
- [ ] `doc/deploy-checklist.md` existe y cubre todos los pasos pre-deploy
- [ ] `.env.example` actualizado con todas las vars del contrato
- [ ] Script exitcode 0 con env completo, exitcode 1 con REQUIRED faltante
- [ ] Sin dependencias externas en el script
- [ ] CI/CD puede ejecutar `node scripts/validate-env.js` antes del build

---

## Context Map

```
.env.example (contrato)
    ↓ parseEnvExample()
validate-env.js
    ↓ keys extraídas
    ├── REQUIRED_VARS (hardcoded Set)
    │   └── process.env check → exit 1 si falta
    └── OPTIONAL_VARS (resto)
        └── process.env check → warning si falta
    ↓
stdout report + exit code
```
