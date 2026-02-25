# SDD — HU-1.3: Test de endpoint en tiempo real

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-25
> **HU origen:** `.nexus/docs/prd/HU-1.3-test-endpoint.md`
> **Linear:** WAS-7 · **Sprint:** 1

---

## Objetivo
Agregar botón "Probar endpoint" en paso 3 del formulario que verifica que el endpoint del creator es alcanzable antes de publicar.

---

## Rutas / Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/creator/test-endpoint` | ✅ | Rate limit 5 req/min. SSRF. Timeout 5s |

**Request:** `{ endpoint_url: string, auth_header?: string }`

**Responses:**
```typescript
{ ok: true,  status: number, latencyMs: number }           // 2xx
{ ok: false, status?: number, error: string }              // 4xx/5xx/timeout
{ error: string }                                          // 400 SSRF / validación
```

---

## Schema de DB / On-chain
Sin cambios.

---

## Componentes UI

### `src/app/api/creator/test-endpoint/route.ts` — NUEVO
```
1. Auth required → 401 si no hay sesión
2. Upstash rate limit: 5 req/min por user_id
3. Zod validate body: endpoint_url (url, required), auth_header (string, optional)
4. validateEndpointUrl(endpoint_url) → 400 si falla
5. AbortController con 5000ms timeout
6. const t0 = Date.now()
7. fetch(endpoint_url, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', ...(auth_header && { Authorization: auth_header }) },
     body: JSON.stringify({ input: 'test' }),
     signal: controller.signal,
   })
8. Si AbortError → { ok: false, error: 'timeout' }
9. Si fetch lanza otro error → { ok: false, error: 'unreachable' }
10. Retornar { ok: res.status < 400, status: res.status, latencyMs: Date.now() - t0 }
    — NO reenviar body del endpoint externo
```

### `src/components/publish/Step3Technical.tsx` — MODIFICAR
Agregar estado local:
```typescript
const [testResult, setTestResult] = useState<{
  ok: boolean; status?: number; latencyMs?: number; error?: string
} | null>(null)
const [testing, setTesting] = useState(false)
```

Función `handleTest`:
```typescript
async function handleTest() {
  setTesting(true); setTestResult(null)
  try {
    const res = await fetch('/api/creator/test-endpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint_url: data.endpoint_url, auth_header: data.auth_header }),
    })
    setTestResult(await res.json())
  } catch { setTestResult({ ok: false, error: 'unreachable' }) }
  finally { setTesting(false) }
}
```

UI inline bajo el campo `endpoint_url`:
- Botón "Probar" desactivado si `testing` o `!data.endpoint_url`
- Estado OK: `✅ OK · {latencyMs}ms` (verde)
- Estado timeout: `❌ No alcanzable (timeout)` (rojo)
- Estado error: `⚠️ Error {status}` (amarillo)
- Nota pequeña: "El timeout de producción puede variar"

---

## Edge Cases

| Caso | Comportamiento |
|------|----------------|
| Timeout (>5s) | AbortError → `{ ok: false, error: 'timeout' }` |
| 4xx/5xx | `{ ok: false, status: N }` → ⚠️ |
| SSRF (IP privada) | validateEndpointUrl → 400 → "URL no permitida" |
| Rate limit | 429 → "Demasiadas pruebas — espera un momento" |
| Campo vacío | Botón desactivado |

---

## Definition of Done

- [ ] `POST /api/creator/test-endpoint`: auth + rate limit 5/min + SSRF + timeout 5s
- [ ] Body externo NO reenviado al frontend
- [ ] 3 estados visuales correctos en Step3Technical
- [ ] Auth header incluido en la llamada si configurado
- [ ] Botón desactivado durante test y con campo vacío
- [ ] `npm run build` limpio — 0 errores, 0 warnings
- [ ] Adversarial review (foco SSRF)
- [ ] AC1–AC7 verificados

---

## Assumptions
- `validateEndpointUrl` cubre todos los casos SSRF sin modificar.
- Body del endpoint externo no se reenvía (solo status + latency).
- Llamada usa POST + `{"input":"test"}` — mismo patrón que invocación real.

---

*SPEC_APPROVED por Fer — 2026-02-25*
