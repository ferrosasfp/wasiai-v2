# Adversarial Review — Hotfix commit bdf2e38
**Scope:** WAS-56 + WAS-58 únicamente  
**Fecha:** 2026-02-27  
**Reviewer:** San (AR role, BMAD v6)

---

## WAS-56 — Analytics route: remoción de `.eq('status', 'active')`

### ✅ OK — Ownership check correcto

**Análisis:**

La route sigue este flujo de autorización:
1. `supabase.auth.getUser()` → 401 si no hay sesión (usa el client validado por JWT, no session cookie cruda)
2. `svc.from('creator_profiles').select(...).eq('id', user.id)` → vincula el profile al `user.id` del token autenticado
3. `svc.from('agents').select(...).eq('creator_id', profile.id)` → solo agentes del creator autenticado
4. Si se pasa `agent_id` por query param, valida que esté dentro de `agents` del creator → 403 si no

**Un creator NO puede ver analytics de otro creator.** El ownership check está correctamente encadenado: `auth.user.id → creator_profile.id → agents.creator_id`. La remoción de `.eq('status', 'active')` solo amplía el scope de qué agentes propios son visibles (incluye draft/pending), sin romper el aislamiento entre creators.

**Sin hallazgos bloqueantes ni menores en WAS-56.**

---

## WAS-58 — NavBar: `useRef` + `onAuthStateChange` INITIAL_SESSION skip

### ⚠️ MENOR — Ventana de email stale si SSR está cacheado

**Análisis del fix:**

```ts
const initialEmailRef = useRef(initialEmail)

const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' && initialEmailRef.current !== null) {
    setLoading(false)
    return  // skip
  }
  setUserEmail(session?.user?.email ?? null)
  setLoading(false)
})
```

**Flujo normal — OK:**
- SSR provee `initialEmail` de user A → INITIAL_SESSION se ignora → email A mostrado correctamente
- User A hace logout → `SIGNED_OUT` event → `userEmail = null` ✅
- User B hace login en la misma pestaña → `SIGNED_IN` event → `userEmail = B's email` ✅

**Flujo problemático identificado (MENOR):**
- Escenario: ISR/CDN cachea la página con el email de user A → user B la carga con `initialEmail=A` en el HTML
- `INITIAL_SESSION` se ignora (porque `initialEmailRef.current !== null`)
- Hasta que Supabase fire el siguiente evento auth, la navbar muestra el email de user A
- **ApiKeyBalance** usa su propio hook (`useApiKeyBalance`) que llama a la API con las cookies reales de user B → muestra el saldo correcto de B
- Resultado: email incorrecto en nav pero datos correctos de balance → confusión de UX, no leak de datos privados

**¿Es leak de email?** No en el sentido estricto — user B ve el email de user A solo si user A fue el último usuario que generó ese HTML cacheado. Es un escenario improbable en producción con `revalidate` bien configurado, pero posible.

**¿Race condition nueva?** No. El fix elimina la race condition anterior (WAS-58 original). La nueva condición de stale email solo ocurre en cache ISR y se auto-resuelve en el siguiente evento auth.

**Recomendación:** Verificar que las rutas que usan `WasiNavBar` con `initialEmail` no tengan `revalidate` muy alto o estén en páginas estáticas sin contexto de usuario.

---

## Auth Bypass en analytics route

### ✅ OK — Sin bypass

- Usa `createClient()` (server client con cookies validadas) para `getUser()`, no `getSession()`
- `createServiceClient()` solo se usa **después** de confirmar que `user` existe
- No hay endpoints con `createServiceClient()` sin auth gate previo
- El `revalidate = 300` (ISR) es para caché de Next.js a nivel de página estática, no afecta a route handlers que son siempre dinámicos

---

## Hardcodes nuevos introducidos

### ✅ OK — Ninguno problemático

Revisado el diff en los 3 archivos. Los comentarios introducidos (`// WAS-56`, `// WAS-58`) son documentación inline. No hay URLs, credenciales, IDs de usuario, ni valores mágicos hardcodeados nuevos.

---

## Resumen ejecutivo

| Item | Severidad | Descripción |
|------|-----------|-------------|
| WAS-56 ownership check | ✅ OK | `creator_id` → `user.id` correctamente encadenado |
| WAS-56 auth bypass | ✅ OK | Sin bypass, service client solo post-auth |
| WAS-58 INITIAL_SESSION skip | ✅ OK | Elimina race condition original sin crear nueva |
| WAS-58 email stale (ISR cache) | ⚠️ MENOR | Email visible en nav puede ser stale en ISR; sin leak de datos privados |
| Hardcodes nuevos | ✅ OK | Ninguno introducido |

**Veredicto: APROBADO con nota menor.** El commit bdf2e38 puede mergearse. El punto MENOR (email stale en ISR) es un UX edge case que no constituye riesgo de seguridad y puede resolverse en una HU posterior si se confirma que hay rutas con ISR + `initialEmail`.
