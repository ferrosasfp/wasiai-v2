# SDD NNN-021 — WAS-38: UI Visual de Pipelines
**Sprint:** 15 | **Fase:** F2 — Software Design Document  
**Autor:** Architect (NexusAgil) | **Fecha:** 2026-03-02  
**Estado:** DRAFT

---

## 1. Contexto

### Qué existe
- `POST /api/v1/compose` en `src/app/api/v1/compose/route.ts` — pipeline síncrono completo
  - Acepta `steps: ComposeStep[]` (max 5), `agent_slug`, `input`, `pass_output`, `parallel`
  - Retorna `{ pipeline_id, steps_executed, groups_executed, total_cost_usdc, result, receipts }`
  - Rate limit: `rl:compose`, 10/1min via `getComposeLimit()`
  - Auth: API key (`x-api-key` header)
- `pipeline_executions` tabla con tracking de estado
- Sistema de webhooks y receipts por step

### Qué falta
- UI visual para construir y ejecutar pipelines
- Componentes: `PipelineBuilder`, `PipelineStatus`, `PipelineHistory`
- Ruta: `src/app/[locale]/pipelines/page.tsx`
- Toggle sync/async (stretch — requiere NNN-019 completado)

### Dependencia con NNN-019
- MVP: solo síncrono (llama directo a `POST /api/v1/compose`)
- Stretch: si NNN-019 está done, agregar toggle que use `POST /api/v1/jobs` para modo async

---

## 2. Archivos a crear/modificar

| Acción | Path |
|--------|------|
| CREAR | `src/app/[locale]/pipelines/page.tsx` |
| CREAR | `src/components/pipelines/PipelineBuilder.tsx` |
| CREAR | `src/components/pipelines/PipelineStatus.tsx` |
| CREAR | `src/components/pipelines/PipelineHistory.tsx` |
| CREAR | `src/components/pipelines/index.ts` (barrel export) |

> No se crea migración. No se modifica `compose/route.ts`.

---

## 3. Interfaces TypeScript

Basadas en `compose/route.ts` — no inventadas:

```typescript
// Reutilizar de compose/route.ts (o re-exportar)
interface ComposeStep {
  agent_slug:   string
  input?:       string
  pass_output?: boolean
  parallel?:    boolean
}

interface ComposeRequest {
  steps: ComposeStep[]
}

interface StepReceipt {
  step:              number
  agent_slug:        string
  cost_usdc:         string
  receipt_signature: string
  call_id:           string
}

interface ComposeResponse {
  pipeline_id:     string
  steps_executed:  number
  groups_executed: number
  total_cost_usdc: string
  result:          unknown
  receipts:        StepReceipt[]
}

interface PipelineFailedResponse {
  error:            string
  code:             'step_failed'
  failed_step:      number
  reason:           string
  steps_executed:   number
  partial_receipts: StepReceipt[]
}

// Estado local del builder
interface PipelineBuilderState {
  steps: ComposeStep[]          // max 5
  apiKey: string                // API key del usuario
  isRunning: boolean
  mode: 'sync' | 'async'        // async solo si NNN-019 done
}

// Estado de ejecución mostrado en PipelineStatus
interface PipelineRunState {
  pipelineId: string | null
  jobId: string | null           // si modo async
  status: 'idle' | 'running' | 'completed' | 'failed'
  result: unknown
  receipts: StepReceipt[]
  totalCost: string
  error: string | null
  stepsExecuted: number
}

// Item de historial (desde pipeline_executions)
interface PipelineHistoryItem {
  id: string                     // pipeline_id
  status: string
  steps_completed: number
  total_cost_usdc: number
  created_at: string
  completed_at: string | null
}
```

---

## 4. Diseño de componentes

### `PipelineBuilder.tsx`
**Responsabilidades:**
- Form para agregar/reordenar/eliminar steps (hasta 5)
- Cada step: selector de agente (dropdown con agentes activos), input textarea, toggle `pass_output`, toggle `parallel`
- Botón "Ejecutar pipeline" → llama `POST /api/v1/compose` con la API key del usuario
- Campo para ingresar API key (guardada en `localStorage`)
- Si NNN-019 done: toggle Síncrono/Asíncrono

**Props:**
```typescript
interface PipelineBuilderProps {
  onRun: (steps: ComposeStep[], mode: 'sync' | 'async') => void
  isRunning: boolean
  availableAgents: { slug: string; name: string; price_per_call: number }[]
}
```

---

### `PipelineStatus.tsx`
**Responsabilidades:**
- Muestra estado de la ejecución en tiempo real
- Modo sync: resultado directo de `ComposeResponse`
- Modo async (stretch): polling a `GET /api/v1/jobs/[id]` cada 2s hasta `completed|failed`
- Muestra receipts por step, costo total, resultado final

**Props:**
```typescript
interface PipelineStatusProps {
  runState: PipelineRunState
  onReset: () => void
}
```

---

### `PipelineHistory.tsx`
**Responsabilidades:**
- Tabla con últimas 20 ejecuciones del usuario (query a `pipeline_executions`)
- Columnas: fecha, steps, costo, estado
- Click en row → expande receipts

**Props:**
```typescript
interface PipelineHistoryProps {
  userId: string
}
```

**Data fetch:** `supabase.from('pipeline_executions').select('id, status, steps_completed, total_cost_usdc, created_at, completed_at').eq('key_id', ...).order('created_at', { ascending: false }).limit(20)`

> Nota: `pipeline_executions` filtra por `key_id`, no por `user_id`. El componente necesitará la `key_id` del API key activo o filtrar distinto si se expone como RPC.

---

### `src/app/[locale]/pipelines/page.tsx`
```typescript
// Layout de la página
export default function PipelinesPage() {
  return (
    <div>
      <PipelineBuilder onRun={handleRun} isRunning={running} availableAgents={agents} />
      {runState.status !== 'idle' && <PipelineStatus runState={runState} onReset={reset} />}
      <PipelineHistory userId={user.id} />
    </div>
  )
}
```

---

## 5. Flujo de ejecución (modo sync — MVP)

```
User clicks "Ejecutar"
  → PipelineBuilder.onRun(steps, 'sync')
  → fetch('POST /api/v1/compose', { headers: { 'x-api-key': apiKey }, body: { steps } })
  → PipelineStatus muestra spinner
  → Response OK → PipelineStatus muestra result + receipts
  → Response 422 → PipelineStatus muestra error + partial_receipts
```

## Flujo modo async (stretch — requiere NNN-019)

```
User selecciona "Asíncrono"
  → fetch('POST /api/v1/jobs', { agent_slug, input })  — primer step
  → Retorna jobId
  → PipelineStatus hace polling a GET /api/v1/jobs/:jobId cada 2s
  → Cuando status = 'completed' → mostrar result
```

> El modo async en MVP solo aplica a pipelines de 1 step. Multi-step async queda fuera de scope.

---

## 6. Migraciones

**Ninguna** — no se crea ni modifica ninguna tabla.  
`pipeline_executions` ya existe (creada en migración de compose).

---

## 7. Acceptance Criteria (EARS)

| # | Formato | AC |
|---|---------|-----|
| AC-01 | WHEN | WHEN el usuario agrega hasta 5 steps en `PipelineBuilder` y hace click en "Ejecutar", SHALL llamar a `POST /api/v1/compose` con los steps configurados. |
| AC-02 | IF | IF el usuario intenta agregar un sexto step, SHALL mostrar error "Máximo 5 steps" y bloquear el botón de agregar. |
| AC-03 | WHEN | WHEN la ejecución síncrona completa, SHALL mostrar en `PipelineStatus` el resultado final, total de costo en USDC y receipts por step. |
| AC-04 | WHEN | WHEN un step falla, SHALL mostrar en `PipelineStatus` el step fallido, la razón del error y los partial_receipts. |
| AC-05 | WHEN | WHEN el usuario visita `/[locale]/pipelines`, SHALL ver el historial de las últimas 20 ejecuciones en `PipelineHistory`. |
| AC-06 | IF | IF NNN-019 (WAS-70) está completado, SHALL mostrar toggle "Síncrono / Asíncrono" en el builder y usar `POST /api/v1/jobs` cuando async está activo. |
| AC-07 | WHEN | WHEN el usuario no tiene API key configurada, SHALL mostrar campo de input para ingresar la clave antes de poder ejecutar. |

---

## 8. Dependencias entre HUs

| Dirección | HU | Detalle |
|-----------|-----|---------|
| Depende de (stretch) | NNN-019 WAS-70 | Toggle async requiere `POST /api/v1/jobs` |
| Reutiliza | `POST /api/v1/compose` | MVP 100% basado en compose existente |
| Independiente de | NNN-020 | No usa sandbox credits |

---

## 9. Constraint Directives

### OBLIGATORIO
- Máx 5 steps — validar en frontend antes de enviar (igual que backend)
- API key guardada en `localStorage` — nunca en estado global compartido
- `pass_output` y `parallel` deben ser configurables por step (expose interface completa)
- Componentes en `src/components/pipelines/` — no en `app/`
- No modificar `compose/route.ts`

### PROHIBIDO
- No crear nueva API route para pipelines — reutilizar `/api/v1/compose`
- No implementar drag-and-drop en MVP (fuera de scope)
- No mostrar `receipt_signature` al usuario (dato interno)
- No hardcodear lista de agentes — fetch desde `GET /api/v1/agents` o tabla `agents`

---

## 10. Implementation Readiness Check

- [x] `compose/route.ts` leído — interfaces `ComposeStep`, `ComposeResponse`, `PipelineFailedResponse` verificadas
- [x] `GET /api/v1/jobs/[id]` leído — patrón polling conocido para modo async
- [x] `pipeline_executions` tabla confirmada en `compose/route.ts` líneas de insert/update
- [x] Max 5 steps validado en backend (`MAX_STEPS = 5`) — frontend debe respetar mismo límite
- [x] Auth via `x-api-key` header confirmado en `compose/route.ts`
- [x] Dependencia NNN-019 documentada como stretch — MVP funciona sin ella
