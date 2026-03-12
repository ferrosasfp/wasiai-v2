# Work Item: HU-070 - Rutas protegidas (Auth Guard)

## User Story
Como Creator, quiero que mis herramientas (Publish, Pipelines, Agent Keys, Dashboard) estén protegidas mediante auth para que ningún usuario anónimo pueda navegar a estas URLs con enlace directo y en su lugar sean redirigidos al Login.

## Contexto
Actualmente, aunque los enlaces están ocultos en el menú para usuarios no logueados, ciertas URLs pueden no tener la protección de capa web (middleware) requerida. En específico, `/pipelines` falta en la regla `isProtectedRoute`.

## Acceptance Criteria (EARS)
1. **WHEN** un usuario no autenticado navega a `/en/pipelines` (o cualquier locale), **THEN** es redirigido a `/en/login`.
2. **WHEN** un usuario no autenticado navega a `/en/publish`, `/en/agent-keys`, o `/en/creator/dashboard`, **THEN** es redirigido a `/en/login`.
3. **WHEN** un usuario no autenticado navega a URLs públicas (`/en`, `/en/sandbox`, `/en/collections`, `/en/docs`), **THEN** se le permite el acceso.

## Scope
- Modificación en `middleware.ts`.

## Constraints
- No alterar lógica de tokens refrescados en middleware.
- Verificación exhaustiva de paths.
