# Report WAS-116 — Capabilities estructuradas en agentes DeFi Risk

**HU:** WAS-116 | **NNN:** 016 | **Modo:** FAST  
**Fecha:** 2026-03-02 | **Estado:** ✅ DONE

---

## Qué se hizo

Se creó la migración `supabase/migrations/029_defi_capabilities_structured.sql` con los UPDATE de capabilities estructuradas (JSONB) para los 5 agentes DeFi Risk.

> **Nota:** El número de migración es 029 (no 025) porque 025–028 ya existían en el repo.

---

## Agentes actualizados

| Slug | Capability name |
|------|----------------|
| `wasi-chainlink-price` | Read Chainlink Price Feed |
| `wasi-onchain-analyzer` | Analyze ERC-20 Token On-Chain |
| `wasi-contract-auditor` | Audit Smart Contract |
| `wasi-defi-sentiment` | DeFi Token Sentiment Analysis |
| `wasi-risk-report` | DeFi Risk Report |

---

## Formato JSONB

Cada capability tiene los campos requeridos por la UI:
- `name` — string
- `description` — string
- `input_type` — "json"
- `output_type` — "json"
- `example_input` — string (JSON escapado)
- `example_output` — string (JSON escapado)

Compatible con `CapabilitiesEditor` del publish form.

---

## Validación SQL

- JSON válido (::jsonb cast confirma tipado)
- UPDATE idempotente (no ON CONFLICT necesario, UPDATE es safe)
- 5 statements, 1 por slug

---

## Archivo creado

- `supabase/migrations/029_defi_capabilities_structured.sql`
