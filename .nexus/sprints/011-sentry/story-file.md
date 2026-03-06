# Story File — 011 — WAS-68: Sentry Error Tracking
**Agente destino:** Dev | **Fecha:** 2026-03-01 | **Modo:** QUALITY | **Branch:** `feat/011-sentry`

> Dev lee SOLO este archivo. Sin SDD, sin HU original, sin contexto adicional.
> Si algo no está aquí → DETENER y preguntar al Architect.

---

## Goal
Instalar y configurar `@sentry/nextjs` en `wasiai-v2` para capturar errores de producción automáticamente — server, client y edge — con fail-silent si `SENTRY_DSN` no está configurado.

---

## Acceptance Criteria

| # | Criterio | Verificable en |
|---|---|---|
| AC-1 | Error en API route → capturado en Sentry con request context | dashboard Sentry |
| AC-2 | Error en browser → capturado en Sentry sin session replay | dashboard Sentry |
| AC-3 | App arranca sin errores si `SENTRY_DSN` ausente | `npm run build` + `npm start` sin DSN |
| AC-4 | Source maps subidos en Vercel build | Sentry dashboard → Issues → stack trace con líneas reales |
| AC-5 | `npm run build` limpio, 0 errores TypeScript | CI |

---

## Archivos a crear

| Archivo | Contenido |
|---|---|
| `sentry.server.config.ts` | DSN + tracesSampleRate: 0.1 + fail-silent |
| `sentry.client.config.ts` | DSN + replaysSessionSampleRate: 0 + fail-silent |
| `sentry.edge.config.ts` | DSN + fail-silent |

## Archivos a modificar

| Archivo | Cambio | Exemplar |
|---|---|---|
| `instrumentation.ts` | Agregar `registerOTelInstrumentation` de Sentry | `src/instrumentation.ts` existente |
| `next.config.mjs` | Wrappear export con `withSentryConfig(nextConfig, sentryOptions)` | `next.config.mjs` existente |

---

## Implementación exacta

### `sentry.server.config.ts`
```typescript
import * as Sentry from '@sentry/nextjs'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
  })
}
```

### `sentry.client.config.ts`
```typescript
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,      // privacidad — sin session replay
    replaysOnErrorSampleRate: 0,
    environment: process.env.NODE_ENV,
  })
}
```

### `sentry.edge.config.ts`
```typescript
import * as Sentry from '@sentry/nextjs'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  })
}
```

### `instrumentation.ts` — agregar
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}
```

### `next.config.mjs` — wrappear
```javascript
import { withSentryConfig } from '@sentry/nextjs'

// ... nextConfig existente ...

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
})
```

---

## Env vars necesarias

| Var | Dónde agregar | Descripción |
|---|---|---|
| `SENTRY_DSN` | Vercel + `.env.local.example` | DSN del proyecto (server/edge) |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel + `.env.local.example` | Mismo DSN (client) |
| `SENTRY_AUTH_TOKEN` | Vercel (build env) | Para source maps |
| `SENTRY_ORG` | Vercel + `.env.local.example` | Org slug en Sentry |
| `SENTRY_PROJECT` | Vercel + `.env.local.example` | Project slug en Sentry |

> Agregar estas vars a `.env.local.example` con valores vacíos — nunca a `.env.local` real.

---

## Constraint Directives

### REQUIRED
- `replaysSessionSampleRate: 0` y `replaysOnErrorSampleRate: 0` — sin session replay
- Fail-silent: guard `if (process.env.SENTRY_DSN)` en server + edge, `if (process.env.NEXT_PUBLIC_SENTRY_DSN)` en client
- `hideSourceMaps: true` en `withSentryConfig` — source maps solo en Sentry, no en bundle público
- `silent: true` en `withSentryConfig` — no pollute build output

### FORBIDDEN
- Capturar `user.email` o `user.wallet` en Sentry context
- `replaysSessionSampleRate > 0`
- Agregar `SENTRY_AUTH_TOKEN` a `.env.local.example` con valor real

---

## Waves

### W0 — Serial
1. `npm install @sentry/nextjs`
2. Crear `sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`

### W1 — Serial
3. Modificar `instrumentation.ts`
4. Modificar `next.config.mjs` con `withSentryConfig`
5. Agregar vars a `.env.local.example`

### W2 — Validación
6. `npm run build` — verificar que compila sin errores
7. Verificar fail-silent: correr sin `SENTRY_DSN` → sin crash

---

## Scope OUT
- Alertas y reglas en dashboard Sentry (configuración manual)
- Performance monitoring (solo error tracking)
- Sentry en `wasiai-agents` repo

---

## Escalation Rule
Si algo no está especificado en este archivo → DETENER y preguntar al Architect. No asumir.
