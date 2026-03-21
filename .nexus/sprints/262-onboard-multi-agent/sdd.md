# SDD #262: Wizard onboarding — registrar N agentes con Agent Key existente

> SPEC_APPROVED: no
> Fecha: 2026-03-20
> Tipo: improvement
> SDD_MODE: full
> Branch: improvement/262-onboard-agent-key-auth
> Linear: WAS-259

---

## 1. Resumen

Un creator que ya tiene cuenta en WasiAI (obtuvo su `wasi_xxxx` al registrar el primer agente) no puede registrar un segundo agente — el wizard lanza 409 al llegar al step del email.

La solución: si el request a `/api/v1/onboard/start` incluye `x-agent-key`, el wizard omite el step de email (no crea usuario) y usa el `owner_id` de esa key como `creator_id` del nuevo agente. El creator pasa por steps 1–7 (nombre, descripción, endpoint, categoría, precio, tags, input_schema) y al final recibe directamente el nuevo slug.

Sin duplicar usuarios. Sin magia sobre emails. Sin riesgo de account takeover.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 262 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Scope IN** | `/api/v1/onboard/start/route.ts` + `/api/v1/onboard/step/route.ts` + `onboarding_sessions` table |
| **Scope OUT** | UI del wizard, auth de otros endpoints, agent_keys budget |

### Acceptance Criteria (EARS)

- AC1: WHEN POST /api/v1/onboard/start includes valid x-agent-key header, SHALL store owner_id in session data
- AC2: WHEN POST /api/v1/onboard/start includes valid x-agent-key, total_steps SHALL be 7 (no email step)
- AC3: WHEN POST /api/v1/onboard/start includes valid x-agent-key, first question SHALL still be agent name (step 1)
- AC4: WHEN session has owner_id (agent-key flow), step 7 SHALL skip createUser and go directly to agent insert
- AC5: WHEN session has owner_id (agent-key flow), step 7 SHALL use session.data.owner_id as creator_id
- AC6: WHEN session has owner_id (agent-key flow), step 7 SHALL generate new API key for that owner_id
- AC7: WHEN session has owner_id (agent-key flow), rollback on agent insert failure SHALL NOT delete the user
- AC8: WHEN POST /api/v1/onboard/start has NO x-agent-key, behavior SHALL be identical to today (8 steps, email last)
- AC9: IF x-agent-key is invalid or inactive, SHALL return 401
- AC10: TypeScript build SHALL pass

---

## 3. Context Map

### Archivos a leer
| Archivo | Por qué |
|---------|---------|
| `src/app/api/v1/onboard/start/route.ts` | Crea la sesión — aquí se detecta el agent key |
| `src/app/api/v1/onboard/step/route.ts` | Step 7 — email + createUser + insert — bifurcar según owner_id en session |
| `src/features/agent-api/services/agent-keys.service.ts` | generateApiKey() — reusar |

### Estado de DB
| Tabla | Columna relevante | Nota |
|-------|------------------|------|
| `onboarding_sessions` | `data` JSONB | Guardar `owner_id` en `data.owner_id` |
| `agent_keys` | `owner_id`, `name`, `key_hash` | name debe ser único por owner — usar slug como name |

---

## 4. Diseño Técnico

### 4.1 Flujo con x-agent-key

```
POST /api/v1/onboard/start
  Header: x-agent-key: wasi_xxxx

1. Validar key en agent_keys (is_active = true)
2. Obtener owner_id de la key
3. Crear sesión con data: { owner_id: "<uuid>" }
4. Retornar total_steps: 7 (no 8)

Steps 1-7: igual que hoy (name, desc, endpoint, category, price, tags, input_schema)
Step 7 final: en vez de preguntar email → insertar agente directamente
  - creator_id = session.data.owner_id
  - Generar nueva API key: name = slug del agente (único)
  - NO llamar createUser
  - Rollback si falla: solo borrar la nueva key — NO tocar el user
```

### 4.2 Archivos a modificar

**Archivo 1: `src/app/api/v1/onboard/start/route.ts`**

Agregar detección de `x-agent-key` ANTES de crear la sesión:

```ts
// Detect agent-key auth (returning creator registering additional agent)
const agentKeyHeader = request.headers.get('x-agent-key')
let ownerIdFromKey: string | null = null

if (agentKeyHeader) {
  const keyHash = createHash('sha256').update(agentKeyHeader).digest('hex')
  const { data: keyRow } = await serviceClient
    .from('agent_keys')
    .select('owner_id')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (!keyRow) {
    return NextResponse.json({ error: 'Invalid or inactive agent key' }, { status: 401 })
  }
  ownerIdFromKey = keyRow.owner_id
}

// Crear sesión — incluir owner_id en data si viene de agent key
const sessionData = ownerIdFromKey ? { owner_id: ownerIdFromKey } : null
const { data: session, error } = await serviceClient
  .from('onboarding_sessions')
  .insert({ ip, data: sessionData })
  .select('id')
  .single()
```

Respuesta con `total_steps` dinámico:
```ts
total_steps: ownerIdFromKey ? 7 : 8,  // 8 incluye email step, 7 no
```

Imports a agregar: `createHash` desde `crypto`, `createServiceClient` (ya importado).

**Archivo 2: `src/app/api/v1/onboard/step/route.ts`**

En el step final (actualmente step 7, que será step 8 para nuevos creators y step 7 para returning creators), bifurcar según `session.data.owner_id`:

Detectar si es flujo de agent-key:
```ts
const isAgentKeyFlow = typeof data.owner_id === 'string' && data.owner_id.length > 0
const totalSteps = isAgentKeyFlow ? 7 : 8
const emailStep = totalSteps  // el email step es el último
```

En el switch, el case del email step:
- **Si `isAgentKeyFlow`:** el step 7 es input_schema (ya manejado en AC del SDD 261 como step 8). **Espera** — ver nota de coordinación abajo.
- **Si `!isAgentKeyFlow`:** el último step sigue siendo email (como hoy, ahora step 8 tras WAS-258).

**NOTA de coordinación con SDD #261:**
- SDD #261 mueve input_schema a un nuevo step (paso 7 actual → nuevo paso 7, email → nuevo paso 8)
- SDD #262 hace que con agent-key el flujo termine en el paso de input_schema (paso 7) sin llegar al email (paso 8)
- El Builder debe aplicar ambos SDDs en el mismo branch o coordinar el orden

**Para el step final con agent-key (step 7 = input_schema en el nuevo flujo):**
El completado del wizard debe detectar `isAgentKeyFlow` y en vez de hacer `createUser`, ir directo al insert:

```ts
// Al final del case del input_schema step, si isAgentKeyFlow:
if (isAgentKeyFlow) {
  // Insertar agente directamente
  const name = String(data.name ?? 'Unnamed Agent')
  let slug = generateSlug(name)
  const { data: existing } = await serviceClient.from('agents').select('id').eq('slug', slug).single()
  if (existing) slug = generateSlug(name, randomBytes(3).toString('hex'))

  const webhookSecret = 'whsec_' + randomBytes(32).toString('hex')
  const { raw, hash } = generateApiKey()

  // Nueva key con nombre = slug (evita colisión con 'wizard-agent')
  const { error: keyError } = await serviceClient.from('agent_keys').insert({
    owner_id: data.owner_id as string,
    name: slug,
    key_hash: hash,
    budget_usdc: 0,
    spent_usdc: 0,
    is_active: true,
  })
  if (keyError) return NextResponse.json({ error: 'Failed to create agent key' }, { status: 500 })

  const { data: agent, error: agentError } = await serviceClient
    .from('agents')
    .insert({
      name,
      slug,
      description: data.description ?? null,
      category: data.category ?? 'nlp',
      price_per_call: data.price_per_call ?? 0.001,
      currency: 'USDC',
      chain: CHAIN_NAME,
      endpoint_url: data.endpoint_url ?? null,
      tags: data.tags ?? [],
      status: 'active',
      is_featured: false,
      creator_id: data.owner_id as string,
      registration_type: 'off_chain',
      mcp_tool_name: slug.replace(/-/g, '_'),
      webhook_secret: webhookSecret,
      example_input: data.example_input ? JSON.stringify(data.example_input) : '{}',
      input_schema: data.input_schema ?? null,
      metadata: { registered_via: 'onboarding_wizard_agent_key' },
    })
    .select('id, slug')
    .single()

  if (agentError || !agent) {
    // Rollback: solo borrar la nueva key — NO tocar el user existente
    await serviceClient.from('agent_keys').delete().eq('key_hash', hash)
    return NextResponse.json({ error: 'Failed to register agent. Please try again.' }, { status: 500 })
  }

  await serviceClient.from('onboarding_sessions').update({ status: 'completed', data }).eq('id', session_id)

  return NextResponse.json({
    completed: true,
    agent_key: raw,
    agent_key_warning: 'Store this key securely. It will not be shown again.',
    slug: agent.slug,
    status: 'active',
    status_message: 'Your agent is now live on the marketplace.',
    agent_url: `https://app.wasiai.io/en/models/${agent.slug}`,
    dashboard_url: `https://app.wasiai.io/en/dashboard`,
  })
}
```

---

## 5. Waves

### Wave 0 — Pre-flight
- [ ] Confirmar que `onboarding_sessions.data` es JSONB (acepta owner_id)
- [ ] Confirmar imports disponibles en start/route.ts (createHash, createServiceClient)
- [ ] Confirmar que `generateApiKey()` está importado en step/route.ts

### Wave 1 — start/route.ts: detección de agent key
- Agregar detección de x-agent-key y lookup en agent_keys
- Guardar owner_id en session.data
- Retornar total_steps dinámico
- **Build gate:** `npx tsc --noEmit`

### Wave 2 — step/route.ts: flujo de completado con agent key
- Detectar `isAgentKeyFlow` al inicio del handler
- En el step final del flujo agent-key: insertar agente + nueva key + no tocar user
- Rollback seguro (solo nueva key, no user)
- **Build gate:** `npx tsc --noEmit`

---

## 6. Rollback

`git revert`. Sin migraciones. Sin cambios en DB schema. Safe.

---

## 7. Constraint Directives

**OBLIGATORIO:**
- Rollback en agent-key flow: SOLO borrar la nueva `agent_key`, NUNCA `deleteUser`
- Nueva API key debe usar `name: slug` (no `'wizard-agent'`) para evitar colisión
- Build gate al final de cada wave

**PROHIBIDO:**
- Modificar el flujo sin agent-key (debe ser idéntico al actual)
- Hacer `deleteUser` en ningún caso del flujo agent-key
- Hacer `git push`
- Modificar auth de otros endpoints

## 8. Prerequisito OBLIGATORIO — SDD #261

**SDD #262 NO puede implementarse sin SDD #261 aplicado primero.**

El Builder DEBE implementar ambos SDDs en el mismo branch, en este orden:
1. Primero: SDD #261 (wizard 8 steps, input_schema en step 7, email en step 8)
2. Despues: SDD #262 (agent-key flow — asume que case 8 = email+insert ya existe)

Branch unificado: `improvement/261-262-onboard-input-schema-multi-agent`

Flujo de steps post-implementacion:
- Sin agent-key: 1→2→3→4→5→6→7(input_schema)→8(email+insert)
- Con agent-key: 1→2→3→4→5→6→7(input_schema+insert) [termina en step 7]
