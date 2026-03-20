# WAS-246 — Work Item

**Tipo:** BUG FIX
**Clasificación:** HU-MINOR

## Descripción

`POST /api/v1/onboard/{session_id}` retorna HTTP 405. El archivo `[session_id]/route.ts` solo define GET. El endpoint de avance de pasos está en `/api/v1/onboard/step` (POST con `{session_id, answer}`), lo que no es REST-intuitive.

**Root cause:** Next.js genera 405 cuando el método no está implementado en el route handler. El usuario (y agents) esperan POST a la URL del recurso `/{session_id}`.

**Fix:** Añadir un handler `POST` en `[session_id]/route.ts` que acepta `{answer}` y delega a la lógica de `/step` (extraída a función compartida), manteniendo `/step` como alias backward-compatible.

## Acceptance Criteria (EARS)

- **AC-01:** WHEN a client POSTs to `/api/v1/onboard/{session_id}` with `{answer: "..."}`, THEN the response MUST be identical to `POST /api/v1/onboard/step` with `{session_id, answer}`.
- **AC-02:** WHEN the session_id is invalid, THEN return HTTP 404 `{error: "Session not found"}`.
- **AC-03:** `POST /api/v1/onboard/step` MUST continue to work as-is (backward compat).
- **AC-04:** No code duplication — la lógica de pasos debe estar en un lugar único (función/util compartida).
- **AC-05:** Rate limit de 5/hora por IP se aplica en `/start`, NO en el avance de pasos (ya existente).
- **AC-06:** La respuesta de `POST /api/v1/onboard/start` DEBE incluir campo `next_url` con la URL canónica para avanzar: `/api/v1/onboard/{session_id}`.

## Files

- `src/app/api/v1/onboard/[session_id]/route.ts` — MODIFY (add POST)
- `src/app/api/v1/onboard/step/route.ts` — MODIFY (extract shared logic + delegate)
- `src/app/api/v1/onboard/start/route.ts` — MODIFY (add `next_url` to response)

