# WasiAI — CLAUDE.md

Marketplace on-chain de agentes IA en Avalanche.

## ⚠️ AMBIENTES — LEER ANTES DE DEPLOY

| Ambiente | Vercel | URL | Supabase | Contrato | Chain |
|----------|--------|-----|----------|----------|-------|
| **Staging** | `wasiai-v2` | wasiai-v2.vercel.app | `bdwvrwzvsldeprfibmuu` | `0x3583fb...` | Fuji (43113) |
| **Producción** | `wasiai-prod` | **app.wasiai.io** (el tráfico real entra por acá; `wasiai-prod.vercel.app` es alias) | `caldzjhjgctpgodldqav` | `0x24be31...` | Mainnet (43114) |

### 🚨 Checklist Pre-Deploy

**Antes de push a `main`:**
- [ ] ¿En qué ambiente quiero deployar? (staging vs prod)
- [ ] ¿Hay migraciones de DB? → Aplicar primero en staging, probar, luego prod
- [ ] ¿Hay cambios de contrato? → Fuji y Mainnet son contratos DIFERENTES
- [ ] ¿Variables de entorno nuevas? → Agregar en AMBOS proyectos Vercel

**Para deployar a PRODUCCIÓN:**
1. Probar cambios en staging primero (wasiai-v2.vercel.app)
2. Ir a Vercel → `wasiai-prod` → Deployments → Redeploy manual
3. NO hacer auto-deploy a prod desde push

**Migraciones de DB:**
```bash
# Staging
npx supabase db push --db-url "postgresql://postgres:[pwd]@db.bdwvrwzvsldeprfibmuu.supabase.co:5432/postgres"

# Producción (⚠️ CUIDADO)
npx supabase db push --db-url "postgresql://postgres:[pwd]@db.caldzjhjgctpgodldqav.supabase.co:5432/postgres"
```

---

**Contrato activo Staging (Fuji v1.3):** `0x3583fb96bAB5DbBDd85CCeA1C4fCE3EfF3249F08`
**Contrato activo Producción (Mainnet):** `0x24be31D0F538C5551c536b09C85907C43c24d062`

---

## Antes de cualquier tarea

Lee siempre:
1. `project-context.md` — contexto completo del proyecto, stack, reglas, patrones
2. `BACKLOG.md` — épicas y prioridades
3. `.claude/skills/nexus-agil/SKILL.md` — metodología activa

---

## Metodología

Ver detalle completo: `METHODOLOGY.md`
Skill oficial: `.claude/skills/nexus-agil/`

WasiAI es siempre modo **QUALITY**. Flujo obligatorio:

```
[Analyst+Architect] F0 Codebase Grounding
[Analyst+Architect] F1 Work Item + ACs EARS
⛔ HU_APPROVED
[Architect+Adversary] F2 SDD + Constraint Directives
⛔ SPEC_APPROVED
[Architect] F2.5 story-HU-X.X.md  ← SIN ESTO NO SE CODEA
[Dev] F3 Anti-Hallucination + Waves
[Adversary] AR → BLOQUEANTE/MENOR/OK
[Adversary+QA] Code Review
[QA] F4 Drift Detection + evidencia archivo:línea
[Docs] DONE → _INDEX.md
git push origin master master:main
```

Gates — texto exacto:
- `HU_APPROVED` — "ok"/"dale"/"go" NO cuentan
- `SPEC_APPROVED` — "implementa"/"empieza" NO cuentan

---

## Golden Path (inmutable)

**Reglas absolutas:**
- Sin hardcodes (contratos, URLs, keys)
- Sin datos simulados en producción
- Sin `NEXT_PUBLIC_` para secrets
- Sin ethers.js → viem v2 (pinned 2.21.0)
- Push: `git push origin master master:main`

---

## Thin-proxy delegation a wasiai-a2a (WKH-66)

Los endpoints `/api/v1/compose`, `/orchestrate`, `/capabilities` y `/mcp`
delegan a `wasiai-a2a` (Railway, repo separado) cuando `V2_DELEGATE_TO_A2A`
incluye el endpoint correspondiente. La lógica canónica vive en a2a — NO
escribir lógica nueva de compose/orchestrate en v2.

### ⚠️ Qué delega cada ambiente: PREGUNTALO, no lo recuerdes (WKH-361)

Este archivo **no** lleva la lista de endpoints delegados por ambiente, a
propósito. Una frase cierta el día que se escribe envejece igual que una falsa
—sólo que nadie la discute— y eso es exactamente lo que dejó a `x-payment-chain`
roto por meses en el camino del dinero. El estado vive en un endpoint:

| Proyecto Vercel | Dominio | Instrumento |
|---|---|---|
| `wasiai-prod` | `app.wasiai.io` | `GET https://app.wasiai.io/api/v1/status/delegation` |
| `wasiai-v2` | `wasiai-v2.vercel.app` | `GET https://wasiai-v2.vercel.app/api/v1/status/delegation` |

Devuelve el ambiente que contesta, los endpoints que está delegando **leídos del
mismo módulo que deciden las rutas**, los nombres de header reenviados y dos
booleanos de presencia de config (nunca sus valores).

La **intención** por ambiente —contra la que ese endpoint se compara— está
versionada en `src/lib/proxy/delegation-manifest.ts`, y el cron
`/api/cron/delegation-drift` (06:00 UTC) avisa solo cuando runtime y manifiesto
divergen. ⛔ El campo `delegated` del manifiesto **jamás** se ajusta a lo
observado para callar al cron.

Última verificación manual de la terna de headers contra `app.wasiai.io`:
**pendiente de la promoción de `wasiai-prod`** (WKH-361 F3, 2026-08-18 — el
defecto sigue reproducible en ese dominio hasta que se promueva).

⚠️ Qué NO hacer en v2:
- NO agregar lógica de pricing/x402/settlement en `/compose` o `/orchestrate`. Va en a2a.
- NO duplicar la lógica de `scope-check` (es dual-use con a2a — mantener inalterado).
  Nota: `agent-discovery` y `step-transform` fueron eliminados en WKH-66 W2 cuando los handlers legacy de `/compose` y `/orchestrate` se reemplazaron por el thin-proxy. No volver a crearlos en v2.
- NO firmar receipts con `WASIAI_V2_KEYPAIR` desde el proxy — la firma viene de a2a.
- NO habilitar `V2_DELEGATE_TO_A2A=mcp` hasta diseñar el shape adapter (rompe MCP clients).

Ver `doc/sdd/072-wkh-66-v2-thin-proxy/sdd.md` para detalles arquitectónicos.

---

## Comandos NexusAgil

| Situación | Acción |
|---|---|
| HU nueva | Actúa como Analyst+Architect. Lee `.claude/skills/nexus-agil/SKILL.md`. Genera Work Item F1. |
| SDD | Actúa como Architect. Codebase Grounding. Genera SDD con template `references/sdd_template.md` |
| Story file | Actúa como Architect. Genera story con template `references/story_file_template.md` |
| Implementar | Actúa como Dev. Lee story file. Anti-Hallucination Protocol. |
| Adversarial Review | Actúa como Adversary. Usa `references/adversarial_review_checklist.md` |
| QA | Actúa como QA. Usa `references/validation_report_template.md`. Evidencia archivo:línea. |
