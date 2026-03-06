# Adversarial Review — WAS-64 (Analytics)

> Fecha: 2026-02-27
> Commit: c061e6b
> Revisado por: Adversary (NexusAgil)
> Scope: `src/features/creator/components/CreatorAnalytics.tsx` + `src/app/api/creator/analytics/route.ts`

---

## Resumen

| Categoria | Resultado | Hallazgos |
|-----------|-----------|-----------|
| 1. AuthZ | OK | Auth verificada con `getUser()` + ownership check de agent_id |
| 2. Inputs | OK | `QuerySchema` con `z.string().uuid().optional()` valida agent_id |
| 3. Inyeccion | OK | Sin concatenación raw, queries via Supabase SDK |
| 4. Secretos | MENOR | `console.error` en producción, ver hallazgo #2 |
| 5. Race Conditions | **BLOQUEANTE** | `activeRef` compartido — fetch stale puede sobrescribir datos correctos |
| 6. Data Exposure | MENOR | `state.data?.summary` puede silenciar bugs de API silenciosamente |
| 7. Mock Data | OK | Sin datos hardcodeados encontrados |
| 8. BD Security | OK | Ownership verificado vía `creator_id === user.id` antes de queries |

---

## Hallazgos BLOQUEANTE

### #B1 — Race condition en `activeRef` al cambiar `selectedAgentId`

**Archivo:** `src/features/creator/components/CreatorAnalytics.tsx`
**Líneas relevantes:** 56–83 (useEffect completo)

**El problema:**

`activeRef` es una referencia **compartida** entre todas las ejecuciones del efecto. El patrón asume que el cleanup del efecto anterior se ejecuta ANTES de que el nuevo efecto configure el ref, pero eso no protege contra fetches en vuelo:

```
1. Efecto A se ejecuta (agentId="abc") → activeRef.current = true
2. Usuario cambia dropdown a agentId="xyz"
3. Cleanup de A → activeRef.current = false, clearInterval
4. Efecto B se ejecuta (agentId="xyz") → activeRef.current = true   ← RESET
5. Fetch de A completa (estaba en vuelo) → chequea activeRef.current → TRUE  ← FALSO POSITIVO
6. setState({ status: 'success', data: datosDeAgentABC })             ← DATOS INCORRECTOS
7. UI muestra analytics del agente equivocado
```

El `activeRef` solo funciona correctamente como guard de unmount. Para cambios de dependencia con fetches en vuelo, falla porque el nuevo efecto resetea el ref a `true` antes de que el fetch viejo resuelva.

**Fix requerido:**

Usar un ID de fetche local por ejecución del efecto, no un ref compartido:

```typescript
useEffect(() => {
  let cancelled = false   // ← variable local, no ref compartida
  const url = selectedAgentId
    ? `/api/creator/analytics?agent_id=${selectedAgentId}`
    : '/api/creator/analytics'

  fetch(url)
    .then(r => {
      if (!r.ok) throw new Error('Failed')
      return r.json() as Promise<AnalyticsData>
    })
    .then(d => {
      if (!cancelled) setState({ status: 'success', data: d })
    })
    .catch((err) => {
      console.error('[CreatorAnalytics] fetch error:', err)
      if (!cancelled) setState({ status: 'error', data: null })
    })

  const interval = setInterval(() => {
    fetch(url)
      .then(r => {
        if (!r.ok) return
        return r.json() as Promise<AnalyticsData>
      })
      .then(d => {
        if (d && !cancelled) setState({ status: 'success', data: d })
      })
      .catch(() => null)
  }, 5 * 60 * 1000)

  return () => {
    cancelled = true
    clearInterval(interval)
  }
}, [selectedAgentId])
```

El `activeRef` puede mantenerse **únicamente** si se necesita para otros propósitos (e.g. cancelar desde fuera del efecto), pero **no** como guard de stale fetch entre rerenders.

---

## Hallazgos MENOR

### #M1 — `state.data?.summary` silencia bugs de API silenciosamente

**Archivo:** `src/features/creator/components/CreatorAnalytics.tsx`
**Línea:** `{state.status === 'success' && state.data?.summary && (`

**El problema:**

Si el API responde 200 con body malformado (e.g. `{ summary: null }` o `{}`), el estado queda en `status: 'success'` pero `data?.summary` es falsy. Resultado: el componente no renderiza nada — ni el estado de error, ni el skeleton de carga, ni un mensaje útil. El usuario ve una sección en blanco sin explicación.

Este escenario puede ocurrir si hay un bug en la route que devuelve `summary: null` en algún edge case (e.g. creator sin `pending_earnings_usdc`).

**Recomendación:**

Agregar validación explícita o un fallback visual:

```typescript
{state.status === 'success' && (
  state.data?.summary
    ? <> {/* renderizar */} </>
    : <div className="text-sm text-gray-400">{t('noData') || 'Sin datos disponibles'}</div>
)}
```

O, más robusto: validar la respuesta con zod en el cliente antes de hacer setState.

---

### #M2 — `console.error` en producción

**Archivo:** `src/features/creator/components/CreatorAnalytics.tsx`
**Línea:** `console.error('[CreatorAnalytics] fetch error:', err)`

**El problema:**

El `err` aquí es `new Error('Failed')` (lanzado manualmente cuando `!r.ok`), así que no contiene datos de usuario directamente. Sin embargo, hay dos sub-problemas:

1. **Logs de producción ruidosos**: En producción, errores de red transitorios (timeout, flap de conexión) van a generar noise constante en la consola / plataformas de logging como Sentry o Vercel.

2. **Potencial futuro**: Si alguien modifica el catch para loguear más contexto (e.g. `url`, respuesta del servidor, headers), puede filtrar datos sensibles sin querer.

**Recomendación:**

Cambiar a un logger condicional o remover en producción:

```typescript
if (process.env.NODE_ENV !== 'production') {
  console.error('[CreatorAnalytics] fetch error:', err)
}
```

O usar el logger interno del proyecto si existe.

---

### #M3 — Interval refresh no verifica `r.ok`

**Archivo:** `src/features/creator/components/CreatorAnalytics.tsx`
**Líneas:** 76–82 (setInterval callback)

**El problema:**

El fetch de auto-refresh llama `r.json()` sin verificar `r.ok`:

```typescript
fetch(url)
  .then(r => r.json() as Promise<AnalyticsData>)  // ← sin chequeo r.ok
  .then(d => {
    if (activeRef.current) setState({ status: 'success', data: d })
  })
```

Si el refresh devuelve un 401 (sesión expirada), 500, o cualquier error, `r.json()` parseará el body de error (e.g. `{ error: 'unauthorized' }`) y lo seteará como `data` con `status: 'success'`. Los subcomponentes (`SummaryCards`, `CallsChart`) recibirán datos malformados y pueden crashear o mostrar valores incorrectos.

**Recomendación:**

```typescript
.then(r => {
  if (!r.ok) return null
  return r.json() as Promise<AnalyticsData>
})
.then(d => {
  if (d && activeRef.current) setState({ status: 'success', data: d })
})
```

---

## Análisis de los puntos específicos solicitados

### ¿El fallback `|| 'Error cargando analytics...'` expone info sensible?
**→ OK.** El fallback es `'Error cargando analytics. Intenta recargar la página.'` — mensaje genérico sin datos internos. No expone stack traces, IDs de usuario, ni detalles de la infraestructura.

### ¿El optional chaining `state.data?.summary` puede ocultar bugs reales silenciosamente?
**→ MENOR (#M1).** Sí puede. Si la API devuelve 200 con `summary: null`, el componente renderiza nada sin ningún feedback visual para el usuario ni error en consola.

### ¿El `console.error` puede logear datos del usuario en producción?
**→ MENOR (#M2).** En la implementación actual, `err` es un Error genérico sin datos de usuario. El riesgo es bajo pero existe como deuda técnica si se amplía el logging.

### Auth bypass en la API route
**→ OK.** La route verifica correctamente:
1. `supabase.auth.getUser()` → 401 si no autenticado
2. Obtiene `creator_profiles` por `user.id` → 404 si no existe perfil
3. Fetches todos los agentes del creator con `eq('creator_id', profile.id)`
4. Si se pasa `agent_id`, verifica ownership con `agents.find(a => a.id === parsed.data.agent_id)` → 403 si no es del creator

No se encontró bypass posible.

### Race conditions en el fetch con activeRef
**→ BLOQUEANTE (#B1).** El patrón `activeRef` falla cuando `selectedAgentId` cambia mientras hay un fetch en vuelo. La variable se resetea a `true` en el nuevo efecto antes de que el fetch viejo resuelva, permitiendo que datos del agente anterior sobrescriban los del agente correcto.

---

## Veredicto

**🔴 BLOCKED** — Hay 1 hallazgo BLOQUEANTE (#B1 race condition en activeRef).

Dev debe:
1. Corregir `#B1` reemplazando `activeRef` con variable local `cancelled` por ejecución de efecto
2. Corregir `#M3` (interval sin verificar `r.ok`) — puede resolverse en el mismo PR ya que está en el mismo bloque de código

Hallazgos `#M1` y `#M2` pueden resolverse como deuda técnica en un PR separado.

Adversary re-revisa después de que Dev corrija `#B1`.
