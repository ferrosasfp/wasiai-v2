# SDD — HU-3.1: Free Trial por Agente

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-25
> **HU origen:** `.nexus/docs/prd/HU-3.1-free-trial.md`
> **Linear:** WAS-10 · **Sprint:** 2

---

## Objetivo
Permitir que cualquier usuario autenticado pruebe un agente con 1 llamada gratuita (lifetime por par usuario+agente) desde la ficha del agente, sin necesitar API key ni USDC.

---

## Rutas / Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/v1/agents/[slug]/trial` | ✅ | 1 trial/usuario/agente. Rate limit 3/IP/hora |
| `GET`  | `/api/v1/agents/[slug]/trial` | ✅ | Verifica si el usuario ya usó su trial |

**Request POST:** `{ input: string }`

**Responses POST:**
```typescript
{ output: string; latencyMs: number }                          // 200 — éxito
{ error: 'already_used' }                                      // 409 — trial ya usado
{ error: 'rate_limited' }                                      // 429 — abuso IP
{ error: 'timeout' }                                           // 504 — agente lento
{ error: 'agent_error'; hint: string }                         // 502 — agente falló
{ error: string }                                              // 400/401/404
```

**Response GET:**
```typescript
{ used: boolean; usedAt?: string }
```

---

## Schema DB — Migration 016

```sql
-- Flag is_trial en agent_calls
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE;

-- Tabla de control de trials
CREATE TABLE IF NOT EXISTS agent_trials (
  id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, agent_id)
);

ALTER TABLE agent_trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_sees_own_trials" ON agent_trials
  FOR SELECT USING (auth.uid() = user_id);

-- Índice para lookup rápido
CREATE INDEX IF NOT EXISTS idx_agent_trials_user_agent
  ON agent_trials (user_id, agent_id);
```

---

## Implementación — Backend

### `src/app/api/v1/agents/[slug]/trial/route.ts` — NUEVO

**GET handler:**
```
1. Auth required → 401
2. Buscar agente por slug → 404 si no existe o status ≠ 'active'
3. SELECT FROM agent_trials WHERE user_id = uid AND agent_id = agent.id
4. Return { used: boolean, usedAt: row?.used_at }
```

**POST handler:**
```
1. Auth required → 401
2. Upstash rate limit: key = `trial:ip:{ip}` → 3 req/hora → 429 si excede
3. Zod validate body: { input: string (min 1, max 2000) } → 400
4. Buscar agente: slug → 404 si no existe o status ≠ 'active'
5. Check agent_trials: SELECT WHERE user_id = uid AND agent_id = agent.id
   → Si existe → 409 { error: 'already_used' }
6. INSERT INTO agent_trials (user_id, agent_id) — ON CONFLICT DO NOTHING
   (idempotente en caso de race condition)
7. AbortController timeout 8000ms
8. const t0 = Date.now()
9. fetch(agent.endpoint_url, {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       ...(agent.auth_header && { Authorization: agent.auth_header }),
     },
     body: JSON.stringify({ input }),
     signal: controller.signal,
   })
10. Si AbortError → log trial en agent_calls (is_trial=true, status_code=504) → 504
11. Si fetch error → log → 502
12. Si res.status >= 400 → log → 502 { error: 'agent_error', hint: 'El agente retornó error' }
    — NO reenviar body del agente en hint (seguridad)
13. const output = await res.text() — máximo 10KB, truncar si mayor
14. Log en agent_calls: { agent_id, caller_agent_id: null, status_code, duration_ms, is_trial: true }
    — NO registrar payer_address (es trial)
15. Return { output, latencyMs: Date.now() - t0 }
```

**Notas de seguridad:**
- `agent.endpoint_url` validado contra `validateEndpointUrl()` (SSRF) — aunque ya fue validado al publicar, re-validar antes de llamar
- Body del agente no se expone en errores
- Output truncado a 10KB para evitar respuestas gigantes

---

## Implementación — Frontend

### `src/app/[locale]/agents/[slug]/page.tsx` — MODIFICAR
- Importar y renderizar `<AgentTrialPlayground slug={slug} />` debajo de la descripción, antes de la sección de API key

### `src/features/agents/components/AgentTrialPlayground.tsx` — NUEVO

```typescript
'use client'

interface Props { slug: string }

type TrialState = 'idle' | 'loading' | 'success' | 'error' | 'timeout' | 'used'

export function AgentTrialPlayground({ slug }: Props) {
  const [input, setInput] = useState('')
  const [state, setState] = useState<TrialState>('idle')
  const [output, setOutput] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Check al montar si ya usó el trial
  useEffect(() => {
    fetch(`/api/v1/agents/${slug}/trial`)
      .then(r => r.json())
      .then(data => { if (data.used) setState('used') })
  }, [slug])

  async function handleTrial() {
    setState('loading')
    setOutput(null)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/v1/agents/${slug}/trial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'already_used') { setState('used'); return }
        if (data.error === 'timeout') { setState('timeout'); return }
        setState('error')
        setErrorMsg(data.error === 'rate_limited'
          ? 'Demasiados intentos. Espera un momento.'
          : 'El agente encontró un error. Puede ser temporal.')
        return
      }
      setState('success')
      setOutput(data.output)
    } catch {
      setState('error')
      setErrorMsg('No se pudo conectar. Intenta de nuevo.')
    }
  }

  // Render según estado:
  // idle/loading → textarea + botón "Probar gratis"
  // used → "Ya probaste este agente" + CTA API key
  // success → output + CTA "Obtener API key"
  // error/timeout → mensaje de error + botón reintentar (si no es 'used')
}
```

**UI detalle:**
- Contenedor con borde y badge "🆓 Prueba gratuita"
- Textarea: `placeholder="Escribe tu input para el agente..."`, maxLength 2000
- Botón desactivado si `input.trim() === ''` o `state === 'loading'`
- Output: `<pre>` con scroll, fondo oscuro, máximo 300px de alto
- CTA post-success: `<Link href="/keys">Obtener API key →</Link>` (Avalanche red)
- Estado `used`: badge "✅ Ya lo probaste" + CTA API key prominente

---

## i18n

Agregar a `en.json` y `es.json`:
```json
{
  "trial": {
    "badge": "Prueba gratuita",
    "placeholder": "Escribe tu input para el agente...",
    "button": "Probar gratis",
    "loading": "Invocando agente...",
    "used": "Ya probaste este agente",
    "cta": "Obtener API key →",
    "error_timeout": "El agente tardó demasiado. Intenta más tarde.",
    "error_generic": "El agente encontró un error. Puede ser temporal.",
    "error_ratelimit": "Demasiados intentos. Espera un momento.",
    "success_cta": "¿Te gustó? Úsalo sin límites con una API key."
  }
}
```

---

## Edge Cases

| Caso | Comportamiento |
|------|----------------|
| Trial ya usado | GET devuelve `used: true` → botón cambia antes de intentar. POST devuelve 409 como fallback |
| Race condition doble click | INSERT ON CONFLICT DO NOTHING → idempotente. Segundo request recibe 409 |
| Agente inactivo/draft | 404 — no se puede hacer trial |
| Input vacío | Botón desactivado en UI; Zod rechaza en backend |
| Output > 10KB | Truncar con nota "Output truncado" |
| Usuario no autenticado | GET/POST devuelven 401 → UI muestra "Inicia sesión para probar gratis" |
| Agente sin auth_header | Se llama sin header Authorization |

---

## Definition of Done

- [ ] Migration 016 aplicada en Supabase prod
- [ ] `GET /api/v1/agents/[slug]/trial` — devuelve `{ used, usedAt }`
- [ ] `POST /api/v1/agents/[slug]/trial` — 1 trial/usuario/agente + rate limit + timeout 8s
- [ ] Body del agente no expuesto en errores
- [ ] Log en `agent_calls` con `is_trial = true`
- [ ] `AgentTrialPlayground` con 5 estados visuales correctos
- [ ] Check al montar → estado `used` si ya probó
- [ ] CTA post-trial visible
- [ ] i18n en/es completo
- [ ] `npm run build` limpio — 0 errores, 0 warnings
- [ ] Adversarial review (foco: SSRF re-validation, race condition, output leak)
- [ ] AC1–AC8 verificados

---

*SPEC_APPROVED — Sprint 2, 2026-02-25*
