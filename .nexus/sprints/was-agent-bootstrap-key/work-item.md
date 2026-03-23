# Work Item — WAS-271

**Fecha:** 2026-03-21
**Clasificación:** QUALITY
**Linear:** WAS-271
**Sprint dir:** .nexus/sprints/was-agent-bootstrap-key/
**Versión:** v5 (post Requirements Review v2)

---

## Problema

El endpoint `POST /api/v1/agents/register` acepta registros `open` sin identidad y crea el agente con `creator_id = null` y sin `management_key`. El agente queda huérfano — nadie puede gestionarlo.

**Ejemplo real:** `gatesolve-captcha` llegó con `creator_id: null`, activado manualmente.

---

## Solución

En el **primer registro open** (sin JWT, sin agent key, sin creator_email), el sistema genera automáticamente una identidad anónima y emite una `management_key`. El endpoint registrado servirá en WAS-272 para recuperación si se pierde la key.

### Constraint de schema
`creator_profiles.id` → FK `auth.users(id)`. `agent_keys.owner_id` → FK `auth.users(id)`. Se requiere `auth.users` entry primero. Se usa email sintético: `agent_<uuid>@bootstrap.wasiai.internal` — mismo patrón que `resolveCreatorFromEmail()`.

---

## Acceptance Criteria (EARS)

**AC1** — Bootstrap anónimo: orden de operaciones
WHEN `POST /api/v1/agents/register` llega con `authMethod === 'open'` O `'open_key'`, SIN `creator_email`, SIN `x-agent-key`, THEN SHALL ejecutar en este orden exacto:
1. Validar body (Zod) — si inválido → 422
2. Verificar slug disponible — si existe → 409 (sin crear nada, sin consumir rate limit)
3. Verificar rate limit por IP — si hit → 429 (sin crear nada)
4. Generar email sintético: `agent_<randomUUID()>@bootstrap.wasiai.internal`
5. `auth.admin.createUser(email, password_aleatorio)` — si falla → 503 `{ error: 'Registration service temporarily unavailable', code: 'bootstrap_failed' }`
6. Insertar `creator_profile` — si falla → rollback (AC5) → 500
7. Insertar agente con `creator_id = userId` — si falla → rollback (AC5) → 500
8. Emitir `management_key` (`owner_id = userId`, `budget_usdc = 0`) — si falla → rollback (AC5) → 500
9. Retornar 201 con `management_key` + `management_key_warning` + `next_steps`

**AC2** — creator_email tiene precedencia sobre bootstrap
WHEN `authMethod === 'open'` O `'open_key'` y el body incluye `creator_email`, THEN SHALL usar `resolveCreatorFromEmail()` (comportamiento actual). El bootstrap anónimo NO se ejecuta.

**AC3** — Respuesta de bootstrap incluye campos exactos
WHEN bootstrap anónimo completa con éxito (201), THEN respuesta SHALL incluir exactamente estos campos adicionales:
```json
{
  "management_key": "wasi_xxx",
  "management_key_warning": "Store this key securely. It will NOT be shown again. Recovery: POST /api/v1/agents/{slug}/recover (coming soon).",
  "next_steps": {
    "publish_another_agent": "POST /api/v1/agents/register with header x-agent-key: <your_key>",
    "update_this_agent": "PATCH /api/v1/agents/{slug} with header x-agent-key: <your_key>",
    "docs": "https://wasiai.io/docs/agents/management-key"
  }
}
```

**AC4** — jwt y agent_key sin cambios
WHEN `authMethod === 'jwt'`, THEN el endpoint SHALL retornar la misma respuesta shape que antes de este cambio (verificable: los campos `management_key`, `next_steps` NO aparecen en respuesta jwt).
WHEN `authMethod === 'agent_key'`, THEN el endpoint SHALL retornar la misma respuesta shape que antes de este cambio.

**AC5** — Atomicidad: rollback en cadena completa
WHEN `auth.users` creado PERO `creator_profile` insert falla → `auth.admin.deleteUser(userId)` best-effort → retornar 500.
WHEN `auth.users` + `creator_profile` creados PERO agente insert falla → `auth.admin.deleteUser(userId)` best-effort (CASCADE elimina creator_profile) → retornar 500.
WHEN agente creado PERO `management_key` insert falla → `auth.admin.deleteUser(userId)` best-effort → retornar 500. (El agente sin key es huérfano — mismo problema original.)
WHEN cualquier `deleteUser` de rollback falla → `console.error('[register] bootstrap rollback failed', { userId, step })` → retornar el error original.

**AC6** — Username único con colisión protegida
WHEN se crea `creator_profile`, username SHALL ser `'agent_' + uuid.slice(0, 8)`. IF colisión (UNIQUE constraint) → intentar `'agent_' + uuid.slice(0, 8) + '_2'`, luego `'_3'`. IF sigue fallando → usar UUID completo como username. IF todas las opciones fallan → rollback AC5 → 500.

**AC7** — Fix probe: 4xx = reviewing, 5xx/timeout = draft
WHEN `probeEndpoint` es invocado (en registro inicial y en reprobes futuros) y recibe HTTP 4xx (400–499), THEN el agente SHALL ser actualizado a `status = 'reviewing'`.
WHEN recibe HTTP 5xx, timeout, o connection error, THEN el agente SHALL ser actualizado a `status = 'draft'`.
Para implementar: `ProbeStatus` type en `health-probe.ts` SHALL ser `'active' | 'reviewing' | 'draft'` (agregar `'draft'`). La función `updateAgentHealth` SHALL aceptar `'draft'` como valor válido.

**AC8** — tsc limpio
WHEN se completan todos los cambios, THEN `npx tsc --noEmit` SHALL pasar sin errores ni warnings.

---

## Scope

**IN:**
- `src/app/api/v1/agents/register/route.ts`
- `src/lib/agents/health-probe.ts`

**OUT:**
- Challenge/recovery por endpoint (WAS-272)
- Revalidación periódica (WAS-273)
- UI dashboard, KYC, wallet-based identity
- Cambios de schema de BD
- jwt y agent_key auth flows

---

## Notas de diseño

- Email `@bootstrap.wasiai.internal` — dominio interno, no se envían emails reales
- `management_key` con `budget_usdc = 0` — gestión, no pagos
- AC2 ya está implementado (`resolveCreatorFromEmail`) — no requiere cambio
- **Limitación conocida:** agente que pierde su key y registra otro slug crea segunda identidad. Resolución en WAS-272.
- Rollback de código: `git revert` a commit `369de6e6f`

---

## Archivos de referencia

| Archivo | Patrón |
|---------|--------|
| `src/app/api/v1/agents/register/route.ts` | `resolveCreatorFromEmail()` → modelo para bootstrap |
| `src/lib/agents/health-probe.ts` | Extender `ProbeStatus`, ajustar lógica 4xx vs 5xx |
| `supabase/migrations/00000000000003_wasiai_core.sql` | DDL de `creator_profiles` y `agent_keys` |
