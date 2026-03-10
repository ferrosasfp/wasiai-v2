# WasiAI — CLAUDE.md

Marketplace on-chain de agentes IA en Avalanche.

## ⚠️ AMBIENTES — LEER ANTES DE DEPLOY

| Ambiente | Vercel | URL | Supabase | Contrato | Chain |
|----------|--------|-----|----------|----------|-------|
| **Staging** | `wasiai-v2` | wasiai-v2.vercel.app | `bdwvrwzvsldeprfibmuu` | `0x3583fb...` | Fuji (43113) |
| **Producción** | `wasiai-prod` | wasiai-prod.vercel.app | `caldzjhjgctpgodldqav` | `0x24be31...` | Mainnet (43114) |

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

## Comandos NexusAgil

| Situación | Acción |
|---|---|
| HU nueva | Actúa como Analyst+Architect. Lee `.claude/skills/nexus-agil/SKILL.md`. Genera Work Item F1. |
| SDD | Actúa como Architect. Codebase Grounding. Genera SDD con template `references/sdd_template.md` |
| Story file | Actúa como Architect. Genera story con template `references/story_file_template.md` |
| Implementar | Actúa como Dev. Lee story file. Anti-Hallucination Protocol. |
| Adversarial Review | Actúa como Adversary. Usa `references/adversarial_review_checklist.md` |
| QA | Actúa como QA. Usa `references/validation_report_template.md`. Evidencia archivo:línea. |
