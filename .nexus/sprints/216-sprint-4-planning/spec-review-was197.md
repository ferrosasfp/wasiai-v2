# Spec Review — WAS-197

> Reviewer: San (NexusAgil v1.3 Spec Reviewer)
> Fecha: 2026-03-14
> SDD: `.nexus/sprints/197-agentkit-wasiai/sdd.md`

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 1. `agentkit-wasiai/package.json` existe | ❌ NO EXISTE | Solo hay `README.md`. No hay `package.json` en el directorio. |
| 2. `agentkit-wasiai/src/` existe | ❌ NO EXISTE | El directorio `src/` no ha sido creado. |
| 3. `agentkit-demo/` existe y tiene código | ✅ OK | Contiene `src/`, `test/`, `package.json`, `tsconfig.json`, `node_modules/`. No tocado. |
| 4. `@coinbase/agentkit ^0.8.0` en npm | ✅ OK (con nota) | `0.8.0` existe y es válido. La versión **latest es `0.10.4`**. `^0.8.0` resolvería a `0.10.4` en `npm install`, lo cual puede introducir breaking changes. |
| 5. `ActionProvider` y `CreateAction` son exports correctos | ✅ OK | Verificado en `@coinbase/agentkit@0.8.0`: `exports.ActionProvider` en `actionProvider.js` y `exports.CreateAction` en `actionDecorator.js`. Ambos re-exportados desde el index. |
| 6. `README.md` compatible con Quickstart propuesto | ⚠️ PARCIAL | El README existente describe un flujo con `npm create onchain-agent@latest` (Vercel AI SDK / Next.js), no el flujo `npm install && npm run demo` propuesto en el SDD. Son quickstarts distintos — el README necesita una sección nueva, no reemplazo. |

---

## Coherencia SDD

| Check | OK/FAIL | Detalle |
|-------|---------|---------|
| AC1 verificable sin prod | ⚠️ PARCIAL | `npm run demo` requiere credenciales CDP reales y un `WASIAI_API_KEY` activo. Sin mock o modo `--dry-run`, el AC solo se puede verificar en un entorno con secrets reales. No hay AC de "dry run" ni modo offline. |
| Cada AC tiene wave que lo implementa | ✅ OK | AC3 → Wave 1; AC5+AC6 → Wave 2; AC2 → Wave 3; AC4 → Wave 4; AC1 → Wave 5 (commit). Cobertura completa. |
| Rollback ejecutable | ✅ OK | Sección 6 clara: `rm -rf src/ package.json` + `git checkout README.md`. Ejecutable en <30 seg. |
| PROHIBIDO tocar `agentkit-demo` en constraints | ✅ OK | Sección 7 (Critical Constraints) incluye: *"PROHIBIDO: Tocar `examples/agentkit-demo/`"*. |

---

## Findings

| # | Severidad | Detalle | Corrección |
|---|-----------|---------|------------|
| 1 | 🔴 BLOCKER | `^0.8.0` en `package.json` resolverá a `0.10.4` (latest) en `npm install`, con potencial breaking change en la API de `AgentKit.from()` y `getLangChainTools()`. El SDD no ha verificado compatibilidad con versiones > 0.8.0. | Fijar versión exacta: `"0.8.0"` sin caret, O actualizar el SDD para usar `0.10.4` tras verificar que la API es compatible. |
| 2 | 🔴 BLOCKER | El `CreateAction` en el SDD (§4.2) usa signatura `async callAgent(args)` con solo 1 parámetro. En `@coinbase/agentkit@0.8.0`, el decorator pasa `(walletProvider, args)` como 2 parámetros (ver README existente que usa `_walletProvider, args`). La signatura del SDD es incorrecta y fallará en TypeScript. | Cambiar a `async callAgent(_walletProvider: WalletProvider, args: z.infer<typeof WasiAISchema>)`. |
| 3 | 🟡 MAJOR | AC1 no es verificable en CI/CD sin credenciales reales. No hay wave para un test offline (mock del fetch). | Agregar Wave opcional: smoke test con `WASIAI_BASE_URL=http://localhost:3001` + servidor mock, o agregar nota en AC1 de que requiere `.env` configurado. |
| 4 | 🟡 MAJOR | El README existente describe un flujo completamente distinto al que propone el SDD (Vercel AI SDK vs tsx directo). Wave 4 dice "ampliar con Quickstart ≤5 pasos" pero el README actual ya tiene un "Setup rápido" que es incompatible con el nuevo flujo. | Renombrar la sección existente a "## Quickstart (Next.js / Vercel AI SDK)" y agregar "## Quickstart (CLI / demo directo)" para el flujo del SDD. |
| 5 | 🟡 MAJOR | `agentkit-demo/package.json` **no tiene `@coinbase/agentkit`** como dependencia (solo `viem` y `dotenv`). El ejemplo `agentkit-demo` no usa AgentKit en absoluto — llama a x402 directamente. El SDD lo describe como "Ejemplo x402 canónico" lo cual es correcto, pero el nombre `agentkit-demo` es confuso para alguien que espera encontrar ejemplos de la API `ActionProvider` ahí. Sin impacto en WAS-197, pero es riesgo de confusión para el juez del hackathon. | Agregar nota en el README de `agentkit-wasiai` que aclare la distinción entre ambos ejemplos. |
| 6 | 🟢 MINOR | `@coinbase/agentkit-langchain` no fue verificado en npm. El SDD lo incluye como dependencia `^0.8.0`. | Confirmar que `@coinbase/agentkit-langchain@0.8.0` existe y es compatible. (Probable que sí, mismo patrón de versioning.) |
| 7 | 🟢 MINOR | El SDD no incluye `tsconfig.json` en ninguna wave, pero lo menciona en la estructura (§4.1). Wave 1 debería incluirlo explícitamente. | Añadir creación de `tsconfig.json` en Wave 1. |

---

## Veredicto: ⛔ NECESITA CORRECCIÓN

**2 blockers** deben resolverse antes de comenzar Wave 2:

1. **Fijar versión de `@coinbase/agentkit`** (caret vs exact) y verificar API de `0.10.4`
2. **Corregir signatura de `CreateAction`** en el snippet de `wasiai-tool.ts` para incluir `_walletProvider` como primer parámetro

Los findings 3 y 4 (MAJOR) pueden resolverse durante la implementación si el dev los acepta, pero deben quedar documentados en el SDD actualizado.

**Acción requerida:** Autor del SDD debe actualizar §4.2 y §4.4 antes de `SPEC_APPROVED: yes`.
