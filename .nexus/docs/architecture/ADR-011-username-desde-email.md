# ADR-011 — Username generado automáticamente desde email

**Fecha:** 2026-02-25  
**Estado:** Aceptado  
**Sprint:** 2 (HU-1.5 Perfil público creator)

---

## Contexto

Para los perfiles públicos de creators (`/creator/[username]`), necesitábamos que cada creator tuviera un username único sin añadir fricción en el onboarding.

Opciones:
- **Campo obligatorio en signup**: El usuario elige su username al registrarse. Más control, pero añade un paso.
- **Derivado automáticamente del email**: `REGEXP_REPLACE(LOWER(SPLIT_PART(email, '@', 1)), '[^a-z0-9_]', '', 'g')`. Cero fricción.
- **UUID como username**: Único garantizado, pero no legible (`/creator/a1b2c3d4`).

---

## Decisión

**Derivado automáticamente del email**, con backfill en migration 016 para creators existentes.

---

## Razones

1. **Onboarding sin fricción** (alineado con HU-1.1): No pedimos más datos de los necesarios.
2. **Usernames legibles**: `/creator/fernando` es mejor UX que `/creator/bdwvr12x`.
3. **Fácil de implementar**: La función SQL `REGEXP_REPLACE(LOWER(SPLIT_PART(email, '@', 1)), '[^a-z0-9_]', '', 'g')` es robusta.
4. **Backfill automático**: La migration 016 calcula usernames para todos los creators existentes.

---

## Consecuencias

- Los usernames pueden colisionar si dos usuarios tienen el mismo prefijo de email. La DB tiene un índice UNIQUE en `username`.
- En caso de colisión (raro en MVP), se añade sufijo numérico en el trigger.
- El creator puede cambiar su username desde el perfil en una futura HU.
- `bio` también se añadió en migration 016 como campo opcional.

---

## Archivos afectados

- `supabase/migrations/016_username_trials.sql`
- `src/features/creator/getCreatorByUsername.ts`
- `src/app/[locale]/creator/[username]/page.tsx`
