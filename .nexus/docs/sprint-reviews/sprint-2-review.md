# Sprint Review — Sprint 2

> **Fecha:** 25 Feb 2026
> **Épicas:** 1 (Creators Reales) + 3 (Free Trial)
> **Estado:** ✅ CERRADO

---

## Qué se entregó

### HU-3.1 — Free Trial por Agente `e0e9366`
- Playground en la ficha de cada agente: textarea + botón + output
- 1 trial lifetime por (usuario, agente) — tabla `agent_trials` con UNIQUE constraint
- Rate limit anti-abuso: 3 intentos/IP/hora via Upstash
- Timeout 8s, SSRF re-validation, body del agente no expuesto en errores
- Log en `agent_calls` con `is_trial = true`
- CTA post-trial → API key purchase
- **14 tests unitarios**

### HU-1.4 — Creator Analytics `d163a43`
- API `/api/creator/analytics` con queries paralelas (Promise.all × 6)
- 5 summary cards: calls 24h, total calls, latencia avg, uptime 24h, earnings USDC
- Gráfica de calls/día últimos 30 días en barras CSS (sin librerías extra)
- Alertas automáticas: error rate >20% en 24h y sin actividad 7 días
- Earnings on-chain vía viem si wallet configurada
- **11 tests unitarios**

### HU-1.5 — Perfil Público del Creator `deb008b`
- Ruta pública `/creator/[username]` con ISR 10 min
- Header: avatar (inicial), nombre, bio, stats pills (agentes, calls, miembro desde)
- Grid de agent cards idéntico al marketplace
- Link desde ficha del agente → perfil del creator
- `generateMetadata` con title y description para SEO
- Migration 016: `username`, `bio` en `creator_profiles`, backfill automático desde email
- **8 tests unitarios**

---

## Tests

| Sprint | Tests antes | Tests después | Failures |
|--------|-------------|---------------|----------|
| Sprint 1 | 0 | 144 | 0 |
| Sprint 2 | 144 | 182 | 0 |

---

## Decisiones técnicas relevantes

- `creator_profiles.id = auth.users.id` — no hay columna `user_id` separada
- `agent_calls` usa `status` ('success'/'error') y `latency_ms` — no `status_code`/`duration_ms`
- Barras CSS en lugar de recharts — evita dependencia extra, suficiente para MVP
- `username` generado desde email con `REGEXP_REPLACE` en backfill
- Rate limit trial: singleton lazy separado del rate limit de invoke

---

## Bugs resueltos en QA

1. `mockReset()` en `beforeEach` — cola `mockReturnValueOnce` se colaba entre tests
2. UUIDs con version/variant bits válidos para Zod v4
3. Patrón thenable para `Promise.all` de queries Supabase en analytics

---

## Commits

| Hash | Descripción |
|------|-------------|
| `e0e9366` | feat(trial): HU-3.1 free trial + migration 016 |
| `d163a43` | feat(analytics): HU-1.4 creator analytics |
| `deb008b` | feat(profile): HU-1.5 perfil público del creator |
| `ef3398c` | test(sprint2): 38 tests unitarios HU-3.1/1.4/1.5 |

---

## Estado del producto al cierre

- **URL prod:** https://wasiai-v2.vercel.app
- **Tests:** 182/182 ✅
- **Build:** limpio ✅
- **Épica 1 (Creators):** ✅ COMPLETA — HU-1.1 + 1.2 + 1.3 + 1.4 + 1.5
- **Épica 3 (Free Trial):** 🔄 HU-3.1 ✅ — HU-3.2 pendiente

---

## Próximo Sprint (Sprint 3)

Candidatos priorizados:

| HU | Épica | Impacto | Esfuerzo |
|----|-------|---------|----------|
| **HU-2.1** SDK Node.js `@wasiai/sdk` | 2 — SDK | Alto | Alto |
| **HU-3.2** Playground comparativo | 3 — Free Trial | Medio | Medio |
| **HU-4.1** Búsqueda semántica | 4 — Discovery | Alto | Alto |
| **UX-07** Hero copy real | P3 | Medio | Bajo |
| **UX-04** Código de ejemplo auto-generado | P3 | Medio | Medio |

Recomendación: **SDK Node.js + UX-07 + UX-04** — máximo impacto para conseguir
los primeros creadores reales externos.
