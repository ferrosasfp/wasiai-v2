# AR Report — WAS-70: Jobs Asíncronos

**Adversary:** San (NexusAgil)  
**Fecha:** 2026-03-02  
**Archivos revisados:**
- `src/app/api/v1/jobs/route.ts`
- `src/app/api/v1/jobs/process/[id]/route.ts`
- `src/lib/webhooks/events.ts`

---

## Resumen ejecutivo

| Clasificación | Cantidad |
|---|---|
| BLOQUEANTE | 2 |
| MENOR | 3 |

---

## 🔴 BLOQUEANTES

### B-01 — Sin rate limit en creación de jobs (DoS)

**Archivo:** `src/app/api/v1/jobs/route.ts`  
**Líneas:** paso [4] — insert directo sin límite

**Descripción:**  
Un usuario autenticado puede hacer POST a `/api/v1/jobs` en bucle sin ningún throttle. Cada llamada inserta un row en `jobs` y dispara una ejecución en el worker. Esto permite:
- Llenar la tabla `jobs` con millones de rows.
- Saturar el worker/queue con ejecuciones paralelas.
- Incurrir en costos por llamadas al agente externo.

**Explotación:** Script con axios en loop — 1000 jobs en segundos.

**Mitigación recomendada:**  
Rate limit vía Upstash Redis (ya disponible en el proyecto) — ej. 10 jobs/minuto por usuario.

```typescript
// Ejemplo con @upstash/ratelimit
const ratelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 m') })
const { success } = await ratelimit.limit(`jobs:${user.id}`)
if (!success) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
```

---

### B-02 — Race condition: doble ejecución del mismo job

**Archivo:** `src/app/api/v1/jobs/process/[id]/route.ts`  
**Líneas:** pasos [2]-[4] — SELECT luego UPDATE no atómico

**Descripción:**  
El chequeo de idempotencia es:
```typescript
// Paso [2]: SELECT
const { data: job } = await serviceClient.from('jobs').select(...).eq('id', id).single()
// Paso [3]: check en memoria
if (job.status !== 'pending') return 409
// Paso [4]: UPDATE (no atómico con el check)
await serviceClient.from('jobs').update({ status: 'processing' }).eq('id', id)
```

Si dos workers llaman `process/[id]` simultáneamente (retry automático, bug en scheduler), ambos leen `status='pending'` antes de que cualquiera ejecute el UPDATE. Ambos pasan el check y ambos ejecutan el agente externo.

**Consecuencias:**
- Doble ejecución del agente (side effects duplicados).
- Posible escritura de resultados distintos (race en el UPDATE final).
- Cobro doble de créditos si aplica.

**Mitigación recomendada:**  
Hacer el check y el update atómico en una sola query:

```sql
-- Opción A: UPDATE con WHERE y verificar rows_affected
UPDATE jobs SET status='processing', updated_at=now()
WHERE id = $1 AND status = 'pending'
RETURNING id;
-- Si no retorna nada → ya está siendo procesado → 409
```

En Supabase:
```typescript
const { data, error } = await serviceClient
  .from('jobs')
  .update({ status: 'processing', updated_at: new Date().toISOString() })
  .eq('id', id)
  .eq('status', 'pending')   // ← condición atómica
  .select('id')
  .single()

if (!data) return NextResponse.json({ error: 'Job already processing' }, { status: 409 })
```

---

## 🟡 MENORES

### M-01 — Job puede quedar stuck en `processing` indefinidamente

**Archivo:** `src/app/api/v1/jobs/process/[id]/route.ts`

**Descripción:**  
Si el proceso del worker muere (crash, OOM, deploy) después del UPDATE a `processing` (paso [4]) pero antes de completar el fetch o el UPDATE final, el job queda en `status='processing'` para siempre. No hay mecanismo de recovery.

**Impacto:** Degradación silenciosa — usuario nunca recibe resultado ni `failed`.

**Mitigación recomendada:**  
- Añadir columna `processing_started_at` y un job de limpieza (cron) que marque como `failed` jobs en `processing` con más de N minutos.
- O añadir TTL/deadline al UPDATE de processing.

---

### M-02 — Sin validación de tamaño/schema del campo `input`

**Archivo:** `src/app/api/v1/jobs/route.ts`  
**Líneas:** paso [2] — solo verifica que `input` no sea null/undefined

**Descripción:**  
El campo `input` acepta cualquier objeto JSON sin límite de tamaño. Un usuario puede enviar un payload de varios MB que se persiste en la DB y se reenvía al agente externo.

**Impacto:** Posible memory pressure en el worker, costos de storage, lentitud de requests.

**Mitigación recomendada:**  
- Validar con Zod: schema del input esperado o al menos un límite de profundidad/tamaño.
- Rechazar con 400 si `JSON.stringify(body.input).length > MAX_INPUT_BYTES`.

---

### M-03 — Agente puede estar inactivo al momento de procesar

**Archivo:** `src/app/api/v1/jobs/process/[id]/route.ts`  
**Líneas:** paso [5] — solo verifica que el agente exista, no que esté `active`

**Descripción:**  
El endpoint de creación verifica `agent.status === 'active'`. Sin embargo, el worker solo hace `.eq('slug', job.agent_slug)` sin filtrar por status. Si el agente fue desactivado entre la creación del job y su procesamiento, el worker igual intentará llamar a `endpoint_url`.

**Impacto:** Llamadas a endpoints de agentes desactivados/deprecados.

**Mitigación recomendada:**  
```typescript
const { data: agent } = await serviceClient
  .from('agents')
  .select('id, endpoint_url, user_id, status')
  .eq('slug', job.agent_slug)
  .eq('status', 'active')   // ← añadir esto
  .single()
```

---

## Checklist de seguridad

| Amenaza | Estado | Nota |
|---|---|---|
| Auth en POST /jobs | ✅ OK | Verifica sesión correctamente |
| Agente existe y activo en creación | ✅ OK | Query con status='active' |
| JOB_PROCESSOR_SECRET ausente | ✅ OK | Si undefined → 401 inmediato |
| IDOR: usuario procesa job ajeno | ✅ OK | Endpoint interno, no expuesto a usuarios |
| Rate limit en creación | 🔴 BLOQUEANTE | B-01 |
| Doble ejecución (race condition) | 🔴 BLOQUEANTE | B-02 |
| Job stuck en processing | 🟡 MENOR | M-01 |
| Tamaño de input sin límite | 🟡 MENOR | M-02 |
| Agente inactivo al procesar | 🟡 MENOR | M-03 |
| Timeout → job marcado failed | ✅ OK | AbortSignal.timeout + catch correcto |
| triggerAgentEvent falla → no afecta resultado | ✅ OK | void best-effort |
| webhooks events.ts correctos | ✅ OK | job.completed + job.failed añadidos |

---

## Veredicto

**2 BLOQUEANTES** deben corregirse antes de merge a main.  
Los 3 MENORES pueden ir como issues post-merge o en la misma PR si el tiempo lo permite.
