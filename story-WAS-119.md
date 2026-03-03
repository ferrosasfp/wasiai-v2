# Story File — WAS-119: Pre-deploy Checklist + Env Validation

**HU:** WAS-119  
**NNN:** 031 / 2 SP / P0  
**SDD:** `doc/sdd/031-deploy-checklist/sdd.md`  
**Estado:** READY_FOR_DEV  

---

## Objetivo

Implementar validación automática de variables de entorno y checklist humano de pre-deploy para WasiAI v2. El script lee las keys del contrato `.env.example` y verifica su presencia en el entorno antes de cada deploy.

---

## Wave W0 — Implementación (serial)

### Tarea 1: `scripts/validate-env.js`

**Archivo:** `scripts/validate-env.js`  
**Módulo:** CommonJS (proyecto sin `"type": "module"`)  
**Deps:** ninguna — Node.js puro  

```javascript
#!/usr/bin/env node
// scripts/validate-env.js
// WAS-119 — Pre-deploy env validation
// Lee keys de .env.example (contrato) y verifica presencia en process.env
// Exit 0 = OK | Exit 1 = REQUIRED var(s) missing

'use strict';

const fs = require('fs');
const path = require('path');

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
  gray:  '\x1b[90m',
};

// ─── REQUIRED vars — rompen en runtime si faltan ──────────────────────────────
const REQUIRED_VARS = new Set([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPERATOR_PRIVATE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'PINATA_JWT',
  'CRON_SECRET',
  'WASIAI_SYSTEM_CREATOR_ID',
  'AGENT_WALLET_ENCRYPTION_KEY',
]);

// ─── Parser de .env.example ───────────────────────────────────────────────────
/**
 * Extrae keys de un archivo .env.example
 * Ignora líneas que empiezan con # y líneas vacías
 * @param {string} filePath
 * @returns {string[]}
 */
function parseEnvExample(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`${c.red}ERROR: .env.example no encontrado en ${filePath}${c.reset}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const keys = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Saltar comentarios y líneas vacías
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Extraer key (todo antes del primer =)
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key) keys.push(key);
  }

  return keys;
}

// ─── Verificación ─────────────────────────────────────────────────────────────
/**
 * @param {string[]} keys
 * @returns {{ ok: string[], missing: string[], warnings: string[] }}
 */
function checkEnv(keys) {
  const ok = [];
  const missing = [];
  const warnings = [];

  for (const key of keys) {
    const value = process.env[key];
    const present = value !== undefined && value !== '';

    if (present) {
      ok.push(key);
    } else if (REQUIRED_VARS.has(key)) {
      missing.push(key);
    } else {
      warnings.push(key);
    }
  }

  return { ok, missing, warnings };
}

// ─── Report ───────────────────────────────────────────────────────────────────
function printReport({ ok, missing, warnings }, totalKeys) {
  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║   WasiAI v2 — Env Validation Report     ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚══════════════════════════════════════════╝${c.reset}\n`);

  if (ok.length > 0) {
    console.log(`${c.green}${c.bold}✅ OK (${ok.length}/${totalKeys})${c.reset}`);
    for (const key of ok) {
      console.log(`   ${c.green}✓${c.reset} ${key}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n${c.yellow}${c.bold}⚠️  OPTIONAL — ausentes (${warnings.length})${c.reset}`);
    for (const key of warnings) {
      console.log(`   ${c.yellow}⚠${c.reset} ${key} ${c.gray}(optional — feature desactivada o tiene default)${c.reset}`);
    }
  }

  if (missing.length > 0) {
    console.log(`\n${c.red}${c.bold}❌ REQUIRED — FALTANTES (${missing.length})${c.reset}`);
    for (const key of missing) {
      console.log(`   ${c.red}✗${c.reset} ${c.bold}${key}${c.reset} ${c.red}← REQUERIDA${c.reset}`);
    }
  }

  console.log(`\n${c.gray}─────────────────────────────────────────────${c.reset}`);

  if (missing.length === 0) {
    console.log(`${c.green}${c.bold}RESULTADO: ✅ Entorno válido — listo para deploy${c.reset}\n`);
  } else {
    console.log(`${c.red}${c.bold}RESULTADO: ❌ Deploy BLOQUEADO — ${missing.length} var(s) REQUIRED faltante(s)${c.reset}`);
    console.log(`${c.gray}Configura las vars marcadas con ❌ antes de continuar.${c.reset}\n`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const envExamplePath = path.resolve(process.cwd(), '.env.example');
  const keys = parseEnvExample(envExamplePath);

  console.log(`${c.gray}Leyendo contrato: ${envExamplePath}${c.reset}`);
  console.log(`${c.gray}Keys en contrato: ${keys.length}${c.reset}`);

  const result = checkEnv(keys);
  printReport(result, keys.length);

  if (result.missing.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
```

---

### Tarea 2: `doc/deploy-checklist.md`

**Archivo:** `doc/deploy-checklist.md`

```markdown
# WasiAI v2 — Pre-Deploy Checklist

> Ejecutar antes de cada deploy a producción o staging.
> Este checklist complementa la validación automática (`npm run validate:env`).

---

## 0. Validación automática de env

```bash
npm run validate:env
```

- ✅ Exit 0 = continuar
- ❌ Exit 1 = STOP — configurar vars faltantes antes de continuar

---

## 1. Contratos (Blockchain)

- [ ] `OPERATOR_PRIVATE_KEY` configurada en Vercel (Environment Variables)
- [ ] `NEXT_PUBLIC_OPERATOR_ADDRESS` corresponde al address del private key
- [ ] `MARKETPLACE_CONTRACT_ADDRESS` apunta al contrato correcto (fuji/mainnet según target)
- [ ] `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` / `_MAINNET` actualizadas si hubo nuevo deploy
- [ ] Treasury address verificada: `WASIAI_TREASURY_ADDRESS` = `NEXT_PUBLIC_WASIAI_TREASURY`

---

## 2. Base de datos (Supabase)

- [ ] `NEXT_PUBLIC_SUPABASE_URL` apunta al proyecto correcto (no a local)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` es el key de producción (no el de dev)
- [ ] Migraciones pendientes aplicadas: `supabase db push` o via dashboard
- [ ] RLS policies verificadas (especialmente en tablas de pagos y wallets)

---

## 3. Storage (Pinata/IPFS)

- [ ] `PINATA_JWT` válido y con permisos de pin
- [ ] `NEXT_PUBLIC_PINATA_GATEWAY` configurado (usar gateway dedicado en prod)

---

## 4. Pagos x402

- [ ] `X402_FACILITATOR_URL` apunta al facilitador correcto
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — rate limiting activo
- [ ] Test de pago end-to-end en staging antes de prod

---

## 5. Seguridad

- [ ] `CRON_SECRET` generado con `openssl rand -hex 32` — NO reutilizar entre ambientes
- [ ] `AGENT_WALLET_ENCRYPTION_KEY` — 64 hex chars — generado y guardado en vault seguro
- [ ] `OPEN_REGISTRATION_KEY` configurado si se activa registro abierto
- [ ] Verificar que NINGUNA var `OPERATOR_PRIVATE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` esté en git

---

## 6. Sistema interno

- [ ] `WASIAI_SYSTEM_CREATOR_ID` es el UUID del creator sistema en la DB de producción
- [ ] Verificar que el creator sistema existe en `SELECT id FROM creators WHERE id = $WASIAI_SYSTEM_CREATOR_ID`

---

## 7. Monitoring (Sentry)

- [ ] `SENTRY_DSN` configurado para el proyecto de producción
- [ ] `SENTRY_ORG` + `SENTRY_PROJECT` + `SENTRY_AUTH_TOKEN` para source maps
- [ ] Test de error reportado correctamente en Sentry dashboard

---

## 8. Build

```bash
npm run qa          # typecheck + lint + tests
npm run build       # producción build — 0 errores
```

- [ ] `npm run qa` — exit 0
- [ ] `npm run build` — exit 0, 0 warnings críticos

---

## 9. Git

- [ ] `git push origin master && git push origin master:main`
- [ ] Vercel auto-deploy triggereado desde `main`
- [ ] Verificar deploy exitoso en Vercel dashboard

---

## 10. Post-deploy smoke test

- [ ] `GET /api/health` → 200
- [ ] Login con wallet funciona
- [ ] Listado de agentes carga (verifica Supabase + IPFS)
- [ ] Pago de prueba en staging (si aplica)
- [ ] Cron endpoint protegido: `GET /api/cron/settle` sin header → 401

---

## Referencias

- SDD: `doc/sdd/031-deploy-checklist/sdd.md`
- HU: WAS-119
- Validación automática: `scripts/validate-env.js`
```

---

### Tarea 3: `.env.example` — contenido completo (keys sin valores reales)

El `.env.example` actual ya existe. Verificar que esté actualizado con este contenido:

```bash
# ─── Supabase ─────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ─── App ──────────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SITE_URL=https://wasiai-v2.vercel.app
NEXT_PUBLIC_DEFAULT_LOCALE=en

# ─── Blockchain — Avalanche ───────────────────────────────────────────────────
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_RPC_TESTNET=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_RPC_MAINNET=https://api.avax.network/ext/bc/C/rpc
NEXT_PUBLIC_DEFAULT_NETWORK=fuji

# ─── Contrato WasiAIMarketplace ───────────────────────────────────────────────
MARKETPLACE_CONTRACT_ADDRESS=
NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI=
NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET=

# ─── Operator Wallet (backend — NUNCA en NEXT_PUBLIC_) ────────────────────────
OPERATOR_PRIVATE_KEY=
NEXT_PUBLIC_OPERATOR_ADDRESS=

# ─── Treasury ─────────────────────────────────────────────────────────────────
WASIAI_TREASURY_ADDRESS=
NEXT_PUBLIC_WASIAI_TREASURY=

# ─── Pagos x402 ───────────────────────────────────────────────────────────────
X402_FACILITATOR_URL=https://facilitator.ultravioletadao.xyz

# ─── Rate limiting (Upstash Redis) ────────────────────────────────────────────
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# ─── Storage (Pinata IPFS) ────────────────────────────────────────────────────
PINATA_JWT=
NEXT_PUBLIC_PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs

# ─── Agentes demo (Groq) ──────────────────────────────────────────────────────
GROQ_API_KEY=

# ─── Cron security — REQUERIDO para /api/cron/* ───────────────────────────────
# Genera con: openssl rand -hex 32
CRON_SECRET=

# ─── Sistema interno ──────────────────────────────────────────────────────────
WASIAI_SYSTEM_CREATOR_ID=
OPEN_REGISTRATION_KEY=

# ─── Sentry (error tracking) ─────────────────────────────────────────────────
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=

# ─── Agent Wallets (WAS-71) ──────────────────────────────────────────────────
# 32 bytes en hex (64 caracteres) — generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
AGENT_WALLET_ENCRYPTION_KEY=
```

---

### Tarea 4: `package.json` — agregar script

En la sección `"scripts"` de `package.json`, agregar **después de `"lint:fix"`**:

```json
"validate:env": "node scripts/validate-env.js",
```

---

## Contrato de integración

| Input | Output |
|---|---|
| `.env.example` (en disco, cwd) | keys: `string[]` |
| `process.env` (runtime) | presencia de cada key: boolean |
| Script completo | exit code `0` (OK) o `1` (REQUIRED faltante) |
| stdout | Tabla coloreada con ANSI |

---

## DoD — Checklist de validación

- [ ] `node scripts/validate-env.js` con env completo → exit 0, "✅ Entorno válido"
- [ ] `node scripts/validate-env.js` con una REQUIRED ausente → exit 1, "❌ Deploy BLOQUEADO"
- [ ] `npm run validate:env` funciona desde la raíz del proyecto
- [ ] `doc/deploy-checklist.md` existe y es completo
- [ ] `.env.example` no contiene valores secretos reales
- [ ] Script no requiere `npm install` — corre con Node.js puro
