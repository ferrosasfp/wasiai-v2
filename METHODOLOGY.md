# WasiAI — Metodología de Ingeniería
## NexusAgil × Golden Path
> Repo oficial: github.com/ferrosasfp/NexusAgile
> Skill instalado: `.claude/skills/nexus-agil/`
> Última actualización: 2026-02-28

---

## Fuente de verdad

La metodología completa vive en:
```
.claude/skills/nexus-agil/SKILL.md                         ← Pipeline completo, 3 modos
.claude/skills/nexus-agil/references/agents_roster.md      ← 9 agentes con roles
.claude/skills/nexus-agil/references/story_file_template.md
.claude/skills/nexus-agil/references/sdd_template.md
.claude/skills/nexus-agil/references/adversarial_review_checklist.md
.claude/skills/nexus-agil/references/validation_report_template.md
```

**No inventar procesos. Leer el skill.**

---

## WasiAI es siempre modo QUALITY

Producción con pagos reales, usuarios reales, datos reales.
El flujo QUALITY completo es obligatorio en cada HU. Sin excepciones.

```
[Analyst + Architect] F0 — Codebase Grounding + project-context.md
[Analyst + Architect] F1 — Work Item: HU + ACs EARS + Scope
⛔ GATE 1: HU_APPROVED
[Architect + Adversary] F2 — SDD + Constraint Directives + Readiness Check
⛔ GATE 2: SPEC_APPROVED
[Architect] F2.5 — story-HU-X.X.md autocontenido (SIN ESTO NO SE CODEA)
[Dev] F3 — Anti-Hallucination Protocol + Waves + Auto-Blindaje
[Adversary] Adversarial Review → BLOQUEANTE / MENOR / OK
[Adversary + QA] Code Review → DEBE CORREGIR / SUGERENCIA
[QA] F4 — Drift Detection + ACs con evidencia archivo:línea
[Docs] DONE → _INDEX.md
git push origin master master:main
# AB-012: Vercel escucha `main` — siempre pushear ambos branches al cerrar sprint
```

---

## Golden Path — Reglas inmutables de stack

### Web2
- Next.js 14 · Supabase · Tailwind · next-intl · Upstash Redis
- **Sin** `NEXT_PUBLIC_` para secrets
- **Sin** hardcodes de addresses o amounts
- **Sin** datos simulados en producción

### Web3
- Avalanche C-Chain · Solidity 0.8.24 · Foundry · **viem v2 (pinned 2.21.0)** · wagmi v3
- **NUNCA ethers.js**
- Pagos: x402 + ERC-3009
- forge test → todos pasan antes de deploy

### Agentes externos
- Repos separados de wasiai-v2 (ej: wasiai-agents)
- Stack: Hono.js + viem v2 + Groq
- Contrato de integración documentado explícitamente en el story file

---

## Gates — texto exacto requerido

| Gate | Texto exacto | Lo que NO activa |
|---|---|---|
| GATE 1 | `HU_APPROVED` | "ok", "dale", "sí", "go", "avanza" |
| GATE 2 | `SPEC_APPROVED` | "implementa", "empieza", cualquier otra cosa |

---

---

## Auto-Blindajes — Reglas permanentes de ingeniería

Aprobados por San. Obligatorios en cada HU, story file y deploy.

| # | Blindaje | Origen |
|---|---------|--------|
| 1 | **ethers.js → siempre versión explícita en story file** — nunca implícita; preferir viem v2 siempre | Sprint 15 |
| 2 | **Commits atómicos obligatorios** — un commit por cambio lógico, nunca acumular en uno solo | Sprint 15 |
| 3 | **Env vars de prod verificadas antes de cada deploy** — usar `doc/deploy-checklist.md`; el SM valida antes de aprobar merge | Sprint 17 |
| 4 | **Plan de infraestructura validado en SDD** — timezones (UTC), redes (fuji/mainnet), endpoints y addresses explícitos | Sprint 17 |
| 5 | **Bugs de navegación client-side → escribir test Playwright primero, luego fix** — sin test reproducible el bug no entra al sprint | Sprint 17 ✅ San |
| 6 | **AB-007 — PAT scopes en planning** — Antes de cada sprint que incluya CI/GitHub Actions: verificar que el PAT tiene scope `workflow`. Si no, es un bloqueante que se resuelve en planning, no a mitad del sprint. | Sprint 18 |
| 7 | **AB-008 — San solo valida, nunca implementa** — San (rol validador/architect) NO ejecuta comandos de Dev, NO hace commits de código, NO corre tests. Su único output son validaciones escritas y gate approvals. Si San hace trabajo de Dev, el pipeline está roto. | Sprint 18 |
| 8 | **AB-009 — AR siempre verifica build** — El Adversary Review DEBE incluir `npm run build` (o `forge test` para contratos) como check obligatorio. Un AR sin verificación de build no está completo. | Sprint 18 |

### Reglas adicionales de stack

- MockUSDC / mocks on-chain: evaluar compatibilidad en F2 Codebase Grounding antes de estimar SP
- Chainlink Automation: siempre documentar trigger manual como fallback en el story file
- Story files con CLI/API/plugins: el contrato de integración debe incluir tipo TypeScript de retorno + ejemplo JSON real + comportamiento en error

---

*NexusAgil instalado: 2026-02-28 — Actualizado: 2026-03-03 (Sprint 18 — AB-007/008/009) — San*
