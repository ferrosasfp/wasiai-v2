# Context Map — Free Trial UX + A2A

## Hallazgos del Q1

### Ya implementado
- `ModelCard` tiene badge free trial (`src/features/models/components/ModelCard.tsx:102`)
- `AgentTrialPlayground` componente (`src/features/agents/components/AgentTrialPlayground.tsx`)
- `/api/v1/agents/[slug]/trial` — GET (check usage) + POST (execute trial)
- `agent_trials` tabla: `{ id, user_id, agent_id, times_used, used_at }`
- `use_trial` RPC en Supabase (atomic check+increment)
- Rate limiting anónimos: 3/día por IP por agente (`checkIpLimit`)
- i18n: keys `trial.*` en messages
- Route C en `/models/{slug}/invoke` (agregado hoy por San) — free trial vía invoke estándar

### Duplicación detectada
Hay **dos paths** para free trial:
1. `/api/v1/agents/{slug}/trial` — para frontend (AgentTrialPlayground)
2. `/api/v1/models/{slug}/invoke` Route C — para API/A2A (agregado hoy)

Ambos trackean en `agent_trials` pero con lógica diferente:
- Trial endpoint usa `use_trial` RPC (atómico)
- Invoke Route C hace upsert manual (no atómico)
- Trial endpoint acepta `{ input: "string" }` (texto plano)
- Invoke Route C acepta el body completo del agente

### Archivos clave
| Archivo | Líneas | Rol |
|---------|--------|-----|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | ~600 | Invoke principal (Routes A, B, C) |
| `src/app/api/v1/agents/[slug]/trial/route.ts` | ~180 | Trial dedicado (frontend) |
| `src/features/agents/components/AgentTrialPlayground.tsx` | ~130 | UI trial en detail page |
| `src/features/models/components/ModelCard.tsx` | ~160 | Card con badge |
| `src/app/[locale]/models/[slug]/page.tsx` | ~350 | Detail page |
| `src/lib/validation/payment-type.ts` | ~10 | Tipos: api_key, x402, free_trial, sandbox |

### Lo que falta
1. **Sandbox mode** — no existe. Necesita: endpoint que devuelva mock data sin ejecutar upstream.
2. **A2A compatibility** — Route C en invoke ya lo hace, pero necesita unificar con el trial endpoint existente.
3. **Reconciliar duplicación** — usar `use_trial` RPC atómico en ambos paths.

### Decisión requerida del PO
- ¿Eliminar Route C del invoke y usar solo `/trial`? → Rompe A2A (diferentes endpoints)
- ¿Mantener ambos pero compartir lógica? → Más código pero mejor compatibilidad
- ¿Migrar todo al invoke con flag? → Breaking change para frontend

### Nota A2A
Para A2A, el agente que invoca usa `/models/{slug}/invoke` con `x-agent-key`. El free trial debería funcionar SIN agent-key (es el punto), así que Route C es el path correcto para A2A. El trial endpoint `/agents/{slug}/trial` seguiría para el frontend.
