# ADR-012 — Trial rate limit: lazy singleton Ratelimit

**Fecha:** 2026-02-25  
**Estado:** Aceptado  
**Sprint:** 2 (HU-3.1 Free Trial)

---

## Contexto

El endpoint de free trial (`POST /api/v1/agents/[slug]/trial`) necesita rate limiting diferente al rate limit principal del marketplace (invocaciones pagadas).

Necesitábamos decidir cómo estructurar el rate limiter para trials.

Opciones:
- **Reutilizar `ratelimit` de `@/lib/upstash`**: Simple, pero mezcla concerns. Los trials tienen reglas distintas (3/hora vs. N/min para invocaciones).
- **Nuevo singleton lazy en el módulo del endpoint**: Creado solo cuando el endpoint es llamado, con su propio prefix `wasiai:trial`.

---

## Decisión

**Lazy singleton** definido en el módulo `trial/route.ts`, con prefix `wasiai:trial` y límite de 3 requests/hora por IP.

---

## Razones

1. **Separación de concerns**: Los trials tienen lógica distinta (1 trial/usuario/agente, adicionalmente limitado por IP).
2. **Cero impacto al rate limit principal**: Las IPs que prueban trials no consumen cuota de invocaciones pagadas.
3. **Lazy initialization**: El Ratelimit se instancia solo si el endpoint existe en la build. Sin side effects en import.
4. **Fácil de tunear**: Si necesitamos cambiar el límite de trials, está en un solo lugar.

---

## Consecuencias

- Limit: `sliding` window, 3 requests/hora por IP (`wasiai:trial:{ip}`).
- Control adicional: tabla `agent_trials` — 1 fila por `(user_id, agent_id)`. El mismo usuario no puede hacer trial del mismo agente dos veces.
- Anónimos limitados solo por IP rate limit.
- `is_trial: true` en `agent_calls` para separar métricas reales de trials.

---

## Archivos afectados

- `src/app/api/v1/agents/[slug]/trial/route.ts`
- `supabase/migrations/016_username_trials.sql` (tabla `agent_trials`, campo `is_trial`)
