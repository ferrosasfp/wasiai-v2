# Async Jobs — WAS-70

WasiAI soporta jobs asíncronos para invocaciones de agentes que pueden tardar segundos o minutos. En lugar de esperar el resultado en la misma request, obtenés un `job_id` y hacés polling hasta que el job se complete.

---

## Crear un job

**`POST /api/v1/jobs`**

Crea un job de invocación asíncrona. Requiere autenticación con tu Agent Key.

### Headers

| Header | Valor |
|--------|-------|
| `Authorization` | `Bearer wasi_<tu_key>` |
| `Content-Type` | `application/json` |

### Body

```json
{
  "agent_slug": "summarizer-pro",
  "input": {
    "text": "Documento largo a resumir..."
  },
  "webhook_url": "https://tu-servidor.com/webhooks/wasiai"
}
```

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `agent_slug` | string | ✅ | Slug del agente a invocar |
| `input` | object | ✅ | Input para el agente |
| `webhook_url` | string | ❌ | URL para notificación al completar |

### Respuesta `202 Accepted`

```json
{
  "job_id": "job_01HXYZ1234ABCD",
  "status": "queued",
  "created_at": "2026-03-02T17:00:00Z",
  "agent_slug": "summarizer-pro"
}
```

---

## Consultar un job

**`GET /api/v1/jobs/:id`**

Retorna el estado actual del job y el resultado cuando esté disponible.

### Estados posibles

| Estado | Descripción |
|--------|-------------|
| `queued` | En cola, aún no se inició |
| `running` | Ejecutándose |
| `completed` | Finalizado con éxito |
| `failed` | Falló — ver campo `error` |

### Respuesta — job completado

```json
{
  "job_id": "job_01HXYZ1234ABCD",
  "status": "completed",
  "created_at": "2026-03-02T17:00:00Z",
  "completed_at": "2026-03-02T17:00:08Z",
  "agent_slug": "summarizer-pro",
  "result": {
    "output": "Resumen del documento..."
  }
}
```

### Respuesta — job fallido

```json
{
  "job_id": "job_01HXYZ1234ABCD",
  "status": "failed",
  "error": "Agent timeout after 30s"
}
```

---

## Webhooks

Si pasás un `webhook_url` al crear el job, WasiAI enviará un `POST` cuando el job termine.

### Evento `job.completed`

```json
{
  "event": "job.completed",
  "job_id": "job_01HXYZ1234ABCD",
  "agent_slug": "summarizer-pro",
  "result": {
    "output": "Resumen del documento..."
  },
  "completed_at": "2026-03-02T17:00:08Z"
}
```

### Evento `job.failed`

```json
{
  "event": "job.failed",
  "job_id": "job_01HXYZ1234ABCD",
  "agent_slug": "summarizer-pro",
  "error": "Agent timeout after 30s",
  "failed_at": "2026-03-02T17:00:35Z"
}
```

> **Seguridad:** Validá que el webhook venga de WasiAI verificando el header `X-WasiAI-Signature` (HMAC-SHA256 del body con tu webhook secret).

---

## Ejemplos de código

### curl

```bash
# Crear job
curl -X POST https://wasiai-v2.vercel.app/api/v1/jobs \
  -H "Authorization: Bearer wasi_tu_key" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_slug": "summarizer-pro",
    "input": { "text": "Texto largo..." },
    "webhook_url": "https://tu-servidor.com/webhooks/wasiai"
  }'

# Polling de estado
curl https://wasiai-v2.vercel.app/api/v1/jobs/job_01HXYZ1234ABCD \
  -H "Authorization: Bearer wasi_tu_key"
```

### TypeScript

```typescript
const WASIAI_BASE = "https://wasiai-v2.vercel.app";
const API_KEY = process.env.WASIAI_API_KEY!;

// Crear job
async function createJob(agentSlug: string, input: Record<string, unknown>) {
  const res = await fetch(`${WASIAI_BASE}/api/v1/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ agent_slug: agentSlug, input }),
  });

  if (!res.ok) throw new Error(`Error creando job: ${res.status}`);
  return res.json() as Promise<{ job_id: string; status: string }>;
}

// Polling con backoff
async function waitForJob(jobId: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${WASIAI_BASE}/api/v1/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const job = await res.json();

    if (job.status === "completed") return job.result;
    if (job.status === "failed") throw new Error(job.error);

    await new Promise((r) => setTimeout(r, 2000)); // 2s entre polls
  }
  throw new Error("Job timeout");
}

// Uso
const { job_id } = await createJob("summarizer-pro", { text: "Texto..." });
const result = await waitForJob(job_id);
console.log(result.output);
```
