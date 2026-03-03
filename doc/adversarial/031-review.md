# Adversarial Review — WAS-119 Pre-deploy checklist + env validation
**NNN-031 | Adversary: San | Modo: QUALITY**
**Fecha:** 2026-03-03
**Commit revisado:** `00d9334` — feat(ops): WAS-119 — pre-deploy checklist + validate-env script

---

## Veredicto global: ⚠️ CONDICIONAL — 1 BLOQUEANTE

| # | Check | Estado | Detalle |
|---|-------|--------|---------|
| 1 | No valores reales en `.env.example` | ✅ OK | Secrets vacíos. Valores no-sensibles (URLs públicas, chain IDs) son aceptables. |
| 2 | Exit code 1 en REQUIRED faltantes | ✅ OK | `process.exit(1)` cuando `missing.length > 0`. Correcto. |
| 3 | Fuente de verdad = `.env.example` | ✅ OK | `parseEnvExample()` lee el archivo; no hay keys hardcodeadas de más. |
| 4 | 10 REQUIRED_VARS correctas | ✅ OK | Set con exactamente 10 entradas, todas críticas para runtime. |
| 5 | `deploy-checklist.md` referencia el script como bloqueante | ✅ OK | Sección 0 — Exit 1 = STOP claramente documentado. |
| 6 | `.env.local` no modificado ni commiteado | ✅ OK | `git diff HEAD~1 HEAD` no incluye `.env.local`. |
| 7 | `npm run build` pasa sin errores | ❌ BLOQUEANTE | ESLint falla en `validate-env.js` — `require()` prohibido. |

---

## BLOQUEANTE — 1 issue

### B-001: `npm run build` falla por ESLint en `scripts/validate-env.js`

**Evidencia:**
```
scripts/validate-env.js
  9:12  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
  10:14  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
✖ 2 problems (2 errors, 0 warnings)
```

**Causa:** `validate-env.js` usa CommonJS (`require('fs')`, `require('path')`).  
El build script ejecuta `eslint . --max-warnings 0` sobre TODO el proyecto, incluyendo `scripts/`.

**Impacto:** Deploy bloqueado — Vercel no buildea si ESLint falla.

**Fix requerido (cualquiera de estas opciones):**

**Opción A — Exclude `scripts/` en ESLint config** (más limpia, recomendada):
```js
// eslint.config.mjs — agregar en ignores:
{ ignores: ['scripts/', ...] }
```

**Opción B — eslint-disable al top del archivo:**
```js
/* eslint-disable @typescript-eslint/no-require-imports */
```

**Opción C — Convertir a ES modules:**
```js
import fs from 'fs';
import path from 'path';
// Cambiar shebang a: #!/usr/bin/env node --input-type=module
// O renombrar a validate-env.mjs
```

**Recomendación:** Opción A — los scripts Node.js son CJS por diseño y no deben ser lintados con reglas de TypeScript ESM.

---

## MENOR — 0 issues

---

## OK — 6/7 checks

---

## Acción requerida antes de cerrar WAS-119

- [ ] Aplicar fix B-001 (excluir `scripts/` de ESLint o disable comment)
- [ ] Verificar `npm run build` pasa con exit 0
- [ ] Re-push a `master` y `main`

El script en sí es correcto: lógica sólida, fuente de verdad correcta, exit codes apropiados, checklist bien documentado. Solo falta arreglar la integración con el pipeline de build.

---

*Adversarial Review completado por San — NexusAgil QUALITY*
