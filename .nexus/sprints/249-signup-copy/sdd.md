# SDD — WAS-249: Signup muestra copy de password reset

## Context
`/check-email` page usa `t('checkEmailMessage')` = "We sent a password reset link to your email."
Ese texto es incorrecto para el flujo de signup. El `ForgotPasswordForm` tiene su propio mensaje
inline (`t('resetLinkSent')`) y no comparte la página `/check-email` — no hay colisión de flujos.

## Acceptance Criteria
- AC-01: `/check-email` muestra "Check your email to confirm your account." (EN)
- AC-02: `/check-email` muestra "Revisa tu correo para confirmar tu cuenta." (ES)
- AC-03: `ForgotPasswordForm` sigue mostrando `t('resetLinkSent')` sin cambios
- AC-04: Build sin errores

## Wave 0 — Pre-flight
1. Leer `messages/en.json` → confirmar clave `checkEmailMessage`
2. Leer `messages/es.json` → confirmar clave `checkEmailMessage`
3. Leer `src/app/[locale]/(auth)/check-email/page.tsx` — confirmar que usa `checkEmailMessage`
4. Confirmar que ForgotPasswordForm usa `resetLinkSent` (no `checkEmailMessage`)

## Wave 1 — Fix copy
- `messages/en.json`: `checkEmailMessage` → "Check your email to confirm your account."
- `messages/es.json`: `checkEmailMessage` → "Revisa tu correo para confirmar tu cuenta."

**Build gate:** `npm run typecheck && npm run lint`

## Rollback
`git revert HEAD` — solo cambia 2 archivos de mensajes

## Critical Constraints
- NO tocar ForgotPasswordForm ni resetLinkSent
- NO crear páginas nuevas
