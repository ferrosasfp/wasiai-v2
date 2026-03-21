# SDD WAS-232: Wizard de Onboarding Conversacional

> SPEC_APPROVED: no
> Fecha: 2026-03-17
> Tipo: feature
> SDD_MODE: full
> Clasificación: HU-MAJOR

---

## 1. Resumen

API REST conversacional (`/api/v1/onboard/*`) que guía a un agente o builder a través de 7 pasos para registrarse en WasiAI. El wizard orquesta los endpoints existentes (`agent-signup`, `agents/register`) sin duplicar lógica.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **Issue** | WAS-232 |
| **Scope IN** | 3 endpoints + migración DB tabla `onboarding_sessions` |
| **Scope OUT** | UI, Discord/Moltbook wizard, cleanup cron |
| **Reutiliza** | `generateApiKey()` (probeEndpoint NO — ver nota), `agent-signup` logic, `agents/register` logic |

### Pasos del wizard (orden fijo)
1. `name` — nombre del agente
2. `description` — descripción (max 500 chars)
3. `endpoint_url` — URL del endpoint (+ ping automático)
4. `category` — nlp/vision/audio/code/multimodal/data
5. `price_per_call` — USDC (0.001 - 100)
6. `tags` — opcional, puede responderse "skip"
7. `email` — crea creator_profile + agent_key → entrega key

---

## 3. Context Map

### Archivos leídos
| Archivo | Patrón extraído |
|---------|-----------------|
| `src/app/api/v1/auth/agent-signup/route.ts` | Creación de user + agent_key, manejo de email duplicado (409), rate limiting |
| `src/app/api/v1/agents/register/route.ts` | Registro de agente, schema validation (probeEndpoint no se usa en wizard — requiere agentId de DB) |
| Ping inline (step3) | NO usar probeEndpoint — escribe en DB por agentId. Usar fetch con AbortSignal.timeout(5000) directo al URL, verificar res.ok |
| `src/lib/ratelimit.ts` (inferido) | `checkRateLimit(limit, identifier)` |

### Tabla nueva: `onboarding_sessions`
```sql
CREATE TABLE onboarding_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip          TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired')),
  current_step INT NOT NULL DEFAULT 1,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes')
);
CREATE INDEX idx_onboarding_sessions_expires ON onboarding_sessions(expires_at);
```

### Exemplar
| Para crear | Seguir patrón de | Razón |
|-----------|------------------|-------|
| `/api/v1/onboard/start/route.ts` | `agent-signup/route.ts` | Mismo rate limiting pattern |
| `/api/v1/onboard/step/route.ts` | `agents/register/route.ts` | Misma validación de endpoint_url (step 3) |

---

## 4. Diseño Técnico

### 4.1 Archivos a crear

| Archivo | Descripción |
|---------|-------------|
| `src/app/api/v1/onboard/start/route.ts` | POST — inicia sesión wizard |
| `src/app/api/v1/onboard/step/route.ts` | POST — avanza un paso |
| `src/app/api/v1/onboard/[session_id]/route.ts` | GET — estado de sesión |

### 4.2 Wave 0 — Pre-flight (Builder)
- [ ] Confirmar que `/api/v1/onboard/` no existe
- [ ] Leer `src/lib/ratelimit.ts` — exporta `checkRateLimit`, `getIdentifier`, `getAgentSignupLimit`
- [ ] NO usar probeEndpoint (requiere agentId de DB que aún no existe). Implementar helper inline: fetch(url, { signal: AbortSignal.timeout(5000) })
- [ ] Confirmar que `validateEndpointUrlAsync` está en `@/lib/security/validateEndpointUrl`
- [ ] Escribir migración SQL de `onboarding_sessions`

### 4.3 Wave 1 — POST /api/v1/onboard/start

```typescript
export async function POST(request: NextRequest) {
  // 1. Rate limit: 5/hora por IP
  const rl = await checkRateLimit(getAgentSignupLimit(), getIdentifier(request))
  if (rl) return rl

  // 2. Crear sesión en onboarding_sessions
  const serviceClient = createServiceClient()
  const ip = getIdentifier(request)
  const { data: session } = await serviceClient
    .from('onboarding_sessions')
    .insert({ ip, status: 'active', current_step: 1, data: {} })
    .select('id').single()

  // 3. Retornar session_id + primera pregunta
  return NextResponse.json({
    session_id: session.id,
    step: 1,
    total_steps: 7,
    question: "What is your agent's name?",
    hint: "A short, descriptive name (3-100 characters)",
  }, { status: 201 })
}
```

**Build gate Wave 1:** `npx tsc --noEmit`

### 4.4 Wave 2 — POST /api/v1/onboard/step

Lógica por step:
- **Step 1-2, 4-6:** validar respuesta, persistir en `data` JSONB, avanzar
- **Step 3 (endpoint_url):** validar URL con `validateEndpointUrlAsync()` + ping inline (NO probeEndpoint) antes de avanzar
- **Step 7 (email):** llamar internamente a `agent-signup` + `agents/register`, marcar `completed`, retornar `agent_key`

```typescript
export async function POST(request: NextRequest) {
  const { session_id, answer } = await request.json()

  // 1. Validar session_id
  const { data: session } = await serviceClient
    .from('onboarding_sessions').select('*').eq('id', session_id).single()
  if (!session) return NextResponse.json({ error: 'session_not_found' }, { status: 404 })
  if (session.status === 'completed') return NextResponse.json({ error: 'session_completed' }, { status: 409 })
  if (new Date(session.expires_at) < new Date()) return NextResponse.json({ error: 'session_expired' }, { status: 404 })
  if (!answer && answer !== 0) return NextResponse.json({ error: 'answer_required' }, { status: 400 })

  // 2. Validar respuesta según step actual
  const stepValidation = validateStep(session.current_step, answer)
  if (!stepValidation.valid) return NextResponse.json({ error: stepValidation.error }, { status: 422 })

  // 3. Si es step 3: probe endpoint
  if (session.current_step === 3) {
    const probe = await pingEndpointForWizard(answer) // inline fetch, no DB write
    if (!probe.ok) return NextResponse.json({ error: 'endpoint_unreachable', detail: probe.reason })
  }

  // 4. Persistir respuesta
  const updatedData = { ...session.data, [STEP_FIELDS[session.current_step]]: answer }

  // 5. Si es último step: completar registro
  if (session.current_step === 7) {
    return await completeWizard(session, updatedData, serviceClient)
  }

  // 6. Avanzar step
  await serviceClient.from('onboarding_sessions')
    .update({ current_step: session.current_step + 1, data: updatedData })
    .eq('id', session_id)

  return NextResponse.json({
    step: session.current_step + 1,
    total_steps: 7,
    question: QUESTIONS[session.current_step + 1],
  })
}
```

**Build gate Wave 2:** `npx tsc --noEmit`

### 4.5 Wave 3 — GET /api/v1/onboard/[session_id] + completeWizard

```typescript
// GET: estado de sesión
export async function GET(request: NextRequest, { params }) {
  const { data: session } = await serviceClient
    .from('onboarding_sessions').select('*').eq('id', params.session_id).single()
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({
    current_step: session.current_step,
    status: session.status,
    completed_fields: Object.keys(session.data),
  })
}

// completeWizard: email → agent-signup → register → devolver key
async function completeWizard(session, data, serviceClient) {
  // 1. Crear user (internamente, misma lógica que agent-signup)
  // 2. Registrar agente (misma lógica que agents/register)
  // 3. Marcar sesión completed
  // 4. Retornar { agent_key, agent_url, slug }
}
```

**Build gate Wave 3:** `npx next build` exit 0

---

## 5. Constraint Directives

### OBLIGATORIO
- Reutilizar `generateApiKey()` (probeEndpoint NO — ver nota) — no reimplementar
- Rate limit en `/start` con patrón existente `checkRateLimit`
- `agent_key` devuelto SOLO en response de step 7 completado
- Expiración: verificar `expires_at` en cada llamada a `/step`
- Migración SQL debe ejecutarse antes del deploy

### PROHIBIDO
- NO duplicar lógica de `agent-signup/route.ts` o `agents/register/route.ts`
- NO guardar `agent_key` en texto plano en `onboarding_sessions.data`
- NO llamar `probeEndpoint()` en ningún step del wizard (requiere agentId de DB)

---

## 6. Rollback

```bash
git revert HEAD  # revertir commit
# + DROP TABLE onboarding_sessions; en prod si ya se migró
```
