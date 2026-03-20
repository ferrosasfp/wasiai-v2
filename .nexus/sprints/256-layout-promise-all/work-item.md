# WAS-256 — Layout: Paralelizar awaits en root layout

**Tipo:** FAST-FIX | **Clasificación:** Quick Flow | **Fecha:** 2026-03-20  
**Archivo afectado:** `src/app/[locale]/layout.tsx`

---

## Contexto

El root layout ejecuta `getMessages()` y `createClient()` secuencialmente. Son operaciones independientes. Al paralelizarlas con `Promise.all`, el tiempo total pasa de ser la suma a ser el máximo de las dos.

**Código actual:**
```ts
const messages = await getMessages()
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
```

**Código objetivo:**
```ts
const [messages, supabase] = await Promise.all([
  getMessages(),
  createClient(),
])
const { data: { user } } = await supabase.auth.getUser()
```

---

## Acceptance Criteria (EARS)

- **AC1:** WHEN the root layout renders, THE system SHALL execute `getMessages()` and `createClient()` in parallel via `Promise.all`.
- **AC2:** WHEN the parallel calls complete, THE destructured result SHALL maintain order `[messages, supabase]` matching the input array order.
- **AC3:** WHEN parallel calls complete, `messages` SHALL be passed to `NextIntlClientProvider` AND `user` SHALL be passed to `WasiNavBar` and `BottomTabBar` as `initialEmail`.
- **AC4:** IF either `getMessages()` or `createClient()` throws, THE error SHALL propagate to the nearest Next.js error boundary without being swallowed by the `Promise.all` wrapper.
- **AC5:** WHEN the change is applied, THE TypeScript build (`tsc --noEmit`) SHALL pass with zero errors.

---

## Scope

**IN:** `src/app/[locale]/layout.tsx` — lines 29-34 only.  
**OUT:** No other files. No DB changes. No auth logic. No provider tree changes.

---

## Dependencias

Ninguna. Se puede aplicar independientemente.

---

## Rollback

`git revert` del commit. Cambio de 1 expresión, sin efectos colaterales.
