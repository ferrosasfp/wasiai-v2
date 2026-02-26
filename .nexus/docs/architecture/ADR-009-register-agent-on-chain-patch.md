# ADR-009 — registerAgentOnChain en PATCH status (no POST)

**Fecha:** 2026-02-25  
**Estado:** Aceptado  
**Sprint:** 1 (HU-1.2 Formulario multipaso)

---

## Contexto

Al diseñar el flujo de publicación de agentes (HU-1.2), necesitábamos decidir cuándo registrar el agente en el contrato on-chain.

Opciones:
- **Al hacer POST (draft creado):** Registro inmediato en el contrato cuando el usuario guarda el draft.
- **Al hacer PATCH status → active:** Registro on-chain solo cuando el usuario explícitamente publica el agente.

---

## Decisión

Registrar on-chain **solo en PATCH status a `active`**, no en el POST inicial.

---

## Razones

1. **No contaminar el contrato con drafts**: Un draft puede ser abandonado, modificado radicalmente, o nunca publicado. Registrarlo on-chain sería irreversible y crearía ruido.
2. **Gas efficiency**: Solo los agentes que realmente se publican gastan gas de registro.
3. **Consistencia semántica**: El contrato solo conoce agentes activos y válidos.
4. **UX correcta**: El creator ve la TX de registro como parte del acto de publicar, no de guardar un borrador.

---

## Consecuencias

- `POST /api/v1/agents` → solo crea registro en DB con `status: 'draft'`
- `PATCH /api/v1/agents/[slug]/status` con `{ status: 'active' }` → llama `registerAgentOnChain()`
- Si el registro on-chain falla, la publicación falla y el agente queda en `draft`
- Los drafts NO aparecen en el marketplace ni en el discovery API

---

## Archivos afectados

- `src/app/api/v1/agents/route.ts`
- `src/app/api/v1/agents/[slug]/status/route.ts`
- `src/lib/chain/registerAgent.ts`
