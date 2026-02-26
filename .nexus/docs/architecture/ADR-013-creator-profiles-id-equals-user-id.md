# ADR-013 — creator_profiles.id = auth.users.id (sin columna user_id separada)

**Fecha:** 2026-02-25  
**Estado:** Aceptado  
**Sprint:** 1 (HU-1.1 Onboarding)

---

## Contexto

Al crear la tabla `creator_profiles`, necesitábamos decidir la clave primaria y la relación con `auth.users`.

Opciones:
- **id UUID autogenerado + columna user_id**: Patrón común en ORMs. Más flexible en teoría.
- **id = auth.users.id**: La PK de `creator_profiles` ES el user ID. Sin columna adicional.

---

## Decisión

**`creator_profiles.id = auth.users.id`** — la PK es directamente el UUID del usuario de Supabase Auth.

---

## Razones

1. **Supabase recomendado**: El patrón oficial de Supabase para perfiles de usuario es exactamente este.
2. **Simplicidad de queries**: No hay JOINs innecesarios. `WHERE id = user.id` en lugar de `WHERE user_id = user.id`.
3. **RLS más limpio**: `auth.uid() = id` es más legible que `auth.uid() = user_id`.
4. **Sin columna redundante**: Si `id` ya es el user ID, una columna `user_id` sería duplicación pura.

---

## Consecuencias

- **CRÍTICO**: Todos los queries a `creator_profiles` deben usar `id`, NO `user_id` (la columna no existe).
- El trigger `handle_new_user()` hace `INSERT INTO creator_profiles (id, ...) VALUES (NEW.id, ...)`.
- Los agentes BMAD y cualquier dev nuevo debe conocer este patrón antes de escribir queries.
- Este ADR existe precisamente para documentar esto y evitar bugs recurrentes.

---

## Archivos afectados

- `supabase/migrations/000_initial.sql` (tabla `creator_profiles`)
- Todo endpoint que acceda a `creator_profiles`
- `project-context.md` → sección "Columnas DB críticas"
