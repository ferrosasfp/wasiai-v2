# Guía para trabajar WasiAI solo con Claude
> Preparada por San — 2026-02-27

---

## Lo más importante antes de empezar

Al inicio de cada sesión dile a Claude:

```
Lee estos archivos antes de hacer cualquier cosa:
1. project-context.md
2. METHODOLOGY.md
3. .nexus/docs/sdd/sprint-status.yaml
```

Sin esto Claude no tiene contexto del proyecto.

---

## Cómo activar cada agente BMAD

### PM (John) — para crear HUs
```
Actúa como el agente PM de BMAD. Lee _bmad/bmm/agents/pm.md y luego project-context.md.
Quiero crear el S0 de la siguiente HU: [describe la idea]
```

### Architect — para crear SDDs
```
Actúa como el agente Architect de BMAD. Lee _bmad/bmm/agents/architect.md y project-context.md.
Genera el SDD para la HU en .nexus/docs/prd/[HU]-s0.md
```

### SM (Bob) — para crear story files
```
Actúa como el agente SM de BMAD. Lee _bmad/bmm/agents/sm.md y project-context.md.
Genera el story file para [HU] usando el S0 en .nexus/docs/prd/ y el SDD en .nexus/docs/sdd/
```

### Dev — para implementar
```
Actúa como el agente Dev de BMAD + Nexus Factory. Lee _bmad/bmm/agents/dev.md y project-context.md.
Implementa la historia desde el story file: story-[HU].md
```

### Adversarial Reviewer — antes del commit
```
Actúa como Adversarial Reviewer de BMAD. Tu trabajo es ENCONTRAR problemas, no confirmar que todo está bien.
Revisa el código implementado en [archivos] buscando: auth bypass, SSRF, race conditions, API keys expuestas, hardcodes, datos simulados.
```

### Code Reviewer — después del AR
```
Actúa como Code Reviewer de BMAD. Revisa calidad del código en [archivos]:
TypeScript correcto, sin any, Server vs Client correcto, i18n sin hardcodes, sin lógica duplicada.
```

### QA — verificación final
```
Actúa como agente QA de BMAD. Lee el story file story-[HU].md y verifica CADA AC contra el código real.
Formato: ✅ CUMPLE / ❌ NO CUMPLE / ⚠️ PARCIAL + archivo:línea como evidencia.
```

---

## El flujo completo (no saltar pasos)

```
1. PM genera S0          → tú escribes HU_APPROVED
2. Architect genera SDD  → tú escribes SPEC_APPROVED
3. SM genera story file  → (sin gate, solo verificas que existe)
4. Dev implementa        → (desde el story file, nada más)
5. AR busca problemas    → Dev corrige BLOQUEANTEs y MENOREs
6. Code Review calidad   → Dev corrige DEBE CORREGIRs
7. QA verifica ACs       → sprint cerrado
8. git push master master:main
```

---

## Gates — exactamente esto debes escribir

| Gate | Texto exacto |
|---|---|
| Aprobar HUs | `HU_APPROVED: [ID1], [ID2]` |
| Aprobar SDD | `SPEC_APPROVED` |

**"Go", "dale", "ok", "sí"** → NO activan el gate.

---

## Reglas Nexus que NUNCA debes romper

Díselas al Dev explícitamente:
- NUNCA ethers.js — usar viem v2 + wagmi v3
- NUNCA NEXT_PUBLIC_ para secrets
- NUNCA hardcodes de addresses, URLs, amounts
- NUNCA datos simulados en producción
- Siempre createServiceClient() para server-side Supabase
- Siempre push: `git push origin master master:main`

---

## Archivos clave del proyecto

| Archivo | Para qué |
|---|---|
| `project-context.md` | Stack, rutas, schema, patrones |
| `METHODOLOGY.md` | Flujo completo BMAD + Nexus |
| `.nexus/docs/sdd/sprint-status.yaml` | Estado de todas las HUs |
| `.nexus/docs/prd/epics.md` | Todas las épicas y HUs |
| `sprint-status.yaml` (raíz) | Sprint actual |
| `story-[HU].md` | Story file del Dev |

---

## Trampas comunes

1. **Claude empieza a codear sin story file** → para y pide el story file primero
2. **Claude mezcla roles** → recuérdale que cada agente tiene su fase
3. **Claude dice "implementado" sin AR** → pide el AR antes de hacer commit
4. **Migration con número equivocado** → siempre verifica el último número en `supabase/migrations/`
5. **Claude usa `created_at` en `agent_calls`** → la columna real es `called_at`

---

## Linear — issues al momento

Cualquier bug, idea o HU que surja en conversación:
→ Crea el issue en Linear INMEDIATAMENTE antes de continuar.
→ API Key: `lin_api_REDACTED_USE_ENV_VAR`
→ Team ID: `507ab2ba-8858-4cb6-8b4c-e3d7d92ebda2`

---

## Estado actual del proyecto (2026-02-27)

- **Sprints completados:** 1–8
- **URL producción:** https://wasiai-v2.vercel.app
- **Contrato:** Fuji testnet `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53`
- **Chain ID:** 43113 (Fuji) — mainnet pendiente Sprint 9
- **Próximo sprint:** Sprint 9 — Tether USDT + Chainlink + HU-3.2 Playground

---

*San — 2026-02-27*
