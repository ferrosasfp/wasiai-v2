# DEUDA-03 — Activar NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true en prod

**Tipo:** FAST-FIX | **Fecha:** 2026-03-15 | **Prioridad:** Media | **Ejecutar después de:** WAS-206 (DONE)

---

## Contexto

`NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA` existe en el código pero no está activado. Creadores pueden publicar sin schema. Solo aplica a **publicaciones nuevas** — no debe bloquear la edición de agentes existentes.

**Archivos afectados:** Solo Vercel env vars (no requiere cambio de código si WAS-206 está deployado)

**⚠️ Nota:** Si un creador edita un agente existente sin schema, el formulario de edición NO debe bloquearlo — la restricción aplica solo a publicaciones nuevas. Verificar que `Step3Technical.tsx` sea exclusivo del flujo de publicación antes de activar.

---

## Scope

**IN:**
- Agregar `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true` en Vercel `wasiai-prod` — environment: **production** únicamente
- Agregar en Vercel `wasiai-v2` — environment: **production** únicamente
- Documentar en `.env.example` para desarrollo local
- Documentar procedimiento de rollback

**OUT:**
- No activar en environments `preview` (rompe PRs de devs sin schema)
- No activar en `development` local (opcional para devs)

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN un creador intenta publicar un agente nuevo sin `input_schema` en `wasiai-prod` (production), THEN el formulario SHALL mostrar el mensaje "Input schema is required to publish your agent" y bloquear el submit.

**AC-2:** WHEN un creador intenta publicar un agente nuevo sin `input_schema` en `wasiai-v2` (testnet, production), THEN el formulario SHALL mostrar el mismo mensaje y bloquear el submit.

**AC-3:** WHEN un creador edita un agente **existente** que no tiene `input_schema`, THEN el formulario de edición SHALL permitir guardar sin requerir schema (solo publicaciones nuevas aplican la restricción).

**AC-4:** WHEN `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true` está activo, THEN agentes existentes publicados sin schema SHALL seguir funcionando en el marketplace sin cambios.

---

## Constraints

- Activar **solo en environment `production`**, no en `preview`
- Ejecutar **después de WAS-206** en DONE — no antes
- **Rollback:** setear `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=false` en Vercel y redeploy (< 2 min)
- Documentar en `.env.example`: `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true # Required for production behavior`
