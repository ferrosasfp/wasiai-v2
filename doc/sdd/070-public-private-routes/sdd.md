# SDD: HU-070 - Rutas protegidas (Auth Guard)

## Objetivo Arquitectónico
Garantizar que las rutas del área Creator (Publish, Pipelines, Agent Keys, Dashboard) estén protegidas a nivel del `edge` en Next.js. El `middleware.ts` es responsable de redirigir a los usuarios no autenticados hacia `/login` cuando intentan acceder vía URL directa.

## Cambios
### 1. `middleware.ts` (Modificación)
Añadir `/pipelines` al helper de verificación `isProtectedRoute`.

```typescript
  const isProtectedRoute =
    pathWithoutLocale.startsWith('/creator/dashboard') ||
    pathWithoutLocale.startsWith('/creator/agents') ||
    pathWithoutLocale.startsWith('/publish') ||
    pathWithoutLocale.startsWith('/agent-keys') ||
    pathWithoutLocale.startsWith('/pipelines')
```

### 2. Archivos Afectados
- `middleware.ts`

## Validation Plan
1. Ejecutar tests the `e2e/docs-public.spec.ts` u otros tests para corroborar que públicos siguen públicos.
2. Navegar de forma manual o escribir test para `/pipelines` sin sesión para validar su redirect 307.

## Constraint Directives
- `[CONSTRAINT-1]` El middleware no debe depender de librerías node-only ya que correrá en Edge runtime.
- `[CONSTRAINT-2]` No omitir forward de cookies en Next Response redirect.
