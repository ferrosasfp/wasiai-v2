# Story WAS-38: UI Visual de Pipelines

**Status:** ready-for-dev  
**Sprint:** 15 | **Épica:** Epic 15 — Pipeline Builder  
**Prioridad:** P2 | **Estimación:** L (~5–6 horas)  
**Dependencias:** MVP independiente. Stretch (toggle async) requiere WAS-70 completado.

---

## Historia de usuario

Como usuario de WasiAI, quiero una interfaz visual para construir y ejecutar pipelines multi-step, para encadenar agentes sin escribir código ni llamar la API manualmente.

---

## Contexto — qué existe hoy

| Archivo | Estado |
|---------|--------|
| `src/app/api/v1/compose/route.ts` | ✅ Existe — pipeline síncrono completo, max 5 steps, auth via `x-api-key` |
| `pipeline_executions` tabla | ✅ Existe — tracking de estado, creada en migración de compose |
| `src/app/api/v1/jobs/[id]/route.ts` | ✅ Existe — patrón polling para modo async (stretch) |

**Qué retorna `POST /api/v1/compose`:**
```json
{
  "pipeline_id": "...",
  "steps_executed": 2,
  "groups_executed": 1,
  "total_cost_usdc": "0.003",
  "result": { ... },
  "receipts": [{ "step": 1, "agent_slug": "...", "cost_usdc": "...", "receipt_signature": "...", "call_id": "..." }]
}
```

**No existe** ninguna UI para pipelines. No existe ningún componente en `src/components/pipelines/`.

---

## Archivos a crear/modificar

| Acción | Path |
|--------|------|
| CREAR | `src/app/[locale]/pipelines/page.tsx` |
| CREAR | `src/components/pipelines/PipelineBuilder.tsx` |
| CREAR | `src/components/pipelines/PipelineStatus.tsx` |
| CREAR | `src/components/pipelines/PipelineHistory.tsx` |
| CREAR | `src/components/pipelines/index.ts` |
| **NO TOCAR** | `src/app/api/v1/compose/route.ts` |
| **NO CREAR** | Ninguna migración de base de datos |

---

## Interfaces TypeScript

> Basadas en `compose/route.ts` — no inventar tipos nuevos.

```typescript
// Reutilizar interfaces de compose — copiar en tipos locales o importar si están exportadas
interface ComposeStep {
  agent_slug:   string
  input?:       string
  pass_output?: boolean
  parallel?:    boolean
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

// Estado local del builder (no compartido globalmente)
interface PipelineBuilderState {
  steps:     ComposeStep[]     // max 5
  apiKey:    string            // guardado en localStorage
  isRunning: boolean
  mode:      'sync' | 'async' // async solo disponible si WAS-70 está done
}

// Estado de ejecución para PipelineStatus
interface PipelineRunState {
  pipelineId:    string | null
  jobId:         string | null   // solo si modo async
  status:        'idle' | 'running' | 'completed' | 'failed'
  result:        unknown
  receipts:      StepReceipt[]
  totalCost:     string
  error:         string | null
  stepsExecuted: number
}

// Historial (desde pipeline_executions)
interface PipelineHistoryItem {
  id:              string    // pipeline_id
  status:          string
  steps_completed: number
  total_cost_usdc: number
  created_at:      string
  completed_at:    string | null
}

// Agente disponible para el builder
interface AvailableAgent {
  slug:           string
  name:           string
  price_per_call: number
}
```

---

## Diseño de componentes

### `src/components/pipelines/PipelineBuilder.tsx`

**Responsabilidades:**
- Form para agregar, reordenar y eliminar steps (hasta 5, validado en frontend)
- Cada step tiene:
  - Selector de agente (dropdown con `availableAgents`)
  - Textarea de input (visible si `pass_output = false`)
  - Toggle `pass_output` — "Usar output del step anterior"
  - Toggle `parallel` — "Ejecutar en paralelo"
- Campo de API key (persiste en `localStorage` con key `wasi_pipeline_api_key`)
- Botón "Ejecutar pipeline" (deshabilitado si `isRunning` o sin steps o sin API key)
- Botón "Agregar step" (deshabilitado si ya hay 5 steps — mostrar mensaje "Máximo 5 steps")
- [STRETCH] Toggle "Síncrono / Asíncrono" — solo renderizar si WAS-70 está disponible

**Props:**
```typescript
interface PipelineBuilderProps {
  onRun:           (steps: ComposeStep[], apiKey: string, mode: 'sync' | 'async') => void
  isRunning:       boolean
  availableAgents: AvailableAgent[]
}
```

---

### `src/components/pipelines/PipelineStatus.tsx`

**Responsabilidades:**
- Muestra estado de la ejecución actual
- `status = 'running'` → spinner
- `status = 'completed'` → JSON del resultado, total costo, lista de receipts por step (sin mostrar `receipt_signature`)
- `status = 'failed'` → step fallido, razón del error, partial_receipts
- Botón "Nueva ejecución" → llama `onReset`

**Props:**
```typescript
interface PipelineStatusProps {
  runState: PipelineRunState
  onReset:  () => void
}
```

**Modo async (stretch):** Si `runState.jobId` existe, hacer polling a `GET /api/v1/jobs/${runState.jobId}` cada 2 segundos hasta que `status === 'completed' || status === 'failed'`. Parar polling en `onReset` o unmount.

---

### `src/components/pipelines/PipelineHistory.tsx`

**Responsabilidades:**
- Tabla con últimas 20 ejecuciones del usuario
- Fetch: `supabase.from('pipeline_executions').select('id, status, steps_completed, total_cost_usdc, created_at, completed_at').order('created_at', { ascending: false }).limit(20)`
- Columnas: Fecha, Steps, Costo USDC, Estado
- Click en fila → expande para mostrar `pipeline_id`

**Props:**
```typescript
interface PipelineHistoryProps {
  userId: string
}
```

> ⚠️ `pipeline_executions` puede filtrar por `key_id` en lugar de `user_id`. Verificar el schema real antes de escribir el query. Si no hay `user_id`, mostrar historial sin filtro de usuario o listar todas las del user via join con `api_keys`.

---

### `src/components/pipelines/index.ts`

```typescript
export { PipelineBuilder } from './PipelineBuilder'
export { PipelineStatus } from './PipelineStatus'
export { PipelineHistory } from './PipelineHistory'
```

---

### `src/app/[locale]/pipelines/page.tsx`

**Server Component** para cargar `availableAgents` y `userId`, luego renderiza componentes cliente.

```typescript
// Lógica de la página:
// 1. Server: obtener user autenticado
// 2. Server: fetch agentes activos (agents.select('slug, name, price_per_call').eq('status', 'active'))
// 3. Client state: steps[], apiKey, runState
// 4. handleRun(steps, apiKey, mode):
//    - modo sync: POST /api/v1/compose con { steps }, header x-api-key
//    - modo async (stretch): POST /api/v1/jobs con primer step
// 5. Renderizar: PipelineBuilder + PipelineStatus (si no idle) + PipelineHistory
```

---

## Flujo de ejecución (MVP — solo síncrono)

```
User configura steps → click "Ejecutar"
  → PipelineBuilder.onRun(steps, apiKey, 'sync')
  → fetch('POST /api/v1/compose', {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps })
    })
  → PipelineStatus muestra spinner (status = 'running')
  → Response 200 → PipelineStatus muestra result + receipts (status = 'completed')
  → Response 422 → PipelineStatus muestra error + failed_step + partial_receipts (status = 'failed')
```

## Flujo modo async (stretch — requiere WAS-70)

```
User selecciona toggle "Asíncrono" → click "Ejecutar"
  → fetch('POST /api/v1/jobs', { agent_slug: steps[0].agent_slug, input: steps[0].input })
  → Retorna { jobId }
  → PipelineStatus hace polling GET /api/v1/jobs/:jobId cada 2s
  → status = 'completed' → mostrar result
```

> Modo async en MVP: solo 1 step. Multi-step async está fuera de scope.

---

## Acceptance Criteria (EARS)

| # | Tipo | Criterio |
|---|------|---------|
| AC-01 | WHEN | WHEN el usuario agrega hasta 5 steps en `PipelineBuilder` y hace click en "Ejecutar", SHALL llamar a `POST /api/v1/compose` con los steps configurados y el header `x-api-key`. |
| AC-02 | IF | IF el usuario intenta agregar un sexto step, SHALL mostrar mensaje "Máximo 5 steps" y deshabilitar el botón de agregar. |
| AC-03 | WHEN | WHEN la ejecución síncrona completa exitosamente, SHALL mostrar en `PipelineStatus` el resultado JSON, el costo total en USDC y los receipts por step (sin `receipt_signature`). |
| AC-04 | WHEN | WHEN un step falla, SHALL mostrar en `PipelineStatus` el número del step fallido, la razón del error y los `partial_receipts`. |
| AC-05 | WHEN | WHEN el usuario visita `/[locale]/pipelines`, SHALL ver el historial de las últimas 20 ejecuciones en `PipelineHistory`. |
| AC-06 | IF | IF el usuario no tiene API key configurada, SHALL mostrar el campo de input de API key y deshabilitar el botón "Ejecutar" hasta que se ingrese una. |
| AC-07 | WHEN | WHEN el usuario ingresa una API key, SHALL persistirla en `localStorage` con key `wasi_pipeline_api_key`. |
| AC-08 | IF | IF WAS-70 (jobs async) está completado, SHALL mostrar toggle "Síncrono / Asíncrono" y usar `POST /api/v1/jobs` cuando async está activo (solo 1 step). |
| AC-09 | WHEN | WHEN modo async activo y job está en `pending` o `processing`, SHALL hacer polling a `GET /api/v1/jobs/:jobId` cada 2s y actualizar el estado visible. |

---

## Restricciones

### OBLIGATORIO
- Máx 5 steps — validar en frontend antes de llamar la API (igual que el backend)
- API key en `localStorage` con key `wasi_pipeline_api_key` — nunca en estado global ni context
- `pass_output` y `parallel` configurables por cada step individualmente
- Componentes en `src/components/pipelines/` — nunca en `app/`
- No mostrar `receipt_signature` en la UI (dato interno)
- Sin `any` — tipos explícitos
- Imports via `@/lib/*`, `@/components/*`, `@/app/*`
- Agentes cargados desde DB (`agents` table) — nunca hardcodeados

### PROHIBIDO
- No crear nueva API route — reutilizar `/api/v1/compose` existente
- No implementar drag-and-drop (fuera de scope del MVP)
- No modificar `compose/route.ts`
- No agregar dependencias npm nuevas (usar UI components existentes del proyecto)

---

## Definition of Done

- [ ] `PipelineBuilder` permite agregar/quitar steps (max 5) con agent selector, input, pass_output y parallel ✓
- [ ] Agregar 6to step → mensaje "Máximo 5 steps" y botón deshabilitado ✓
- [ ] Sin API key → campo visible, botón ejecutar deshabilitado ✓
- [ ] API key persiste en `localStorage` ✓
- [ ] Click "Ejecutar" → POST a `/api/v1/compose` con steps + x-api-key ✓
- [ ] Ejecución exitosa → `PipelineStatus` muestra result + costo + receipts (sin receipt_signature) ✓
- [ ] Step fallido → `PipelineStatus` muestra error + failed_step + partial_receipts ✓
- [ ] `PipelineHistory` muestra últimas 20 ejecuciones ✓
- [ ] [STRETCH] Toggle sync/async visible si WAS-70 disponible ✓
- [ ] [STRETCH] Modo async: polling a jobs/[id] cada 2s ✓
- [ ] `src/components/pipelines/index.ts` exporta los 3 componentes ✓
- [ ] `npm run build` sin errores TypeScript ni ESLint ✓
- [ ] Sin `any` en el código nuevo ✓
- [ ] `git push origin master && git push origin master:main` ✓

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes
_(completar al implementar)_

### File List
- `src/app/[locale]/pipelines/page.tsx` — CREAR
- `src/components/pipelines/PipelineBuilder.tsx` — CREAR
- `src/components/pipelines/PipelineStatus.tsx` — CREAR
- `src/components/pipelines/PipelineHistory.tsx` — CREAR
- `src/components/pipelines/index.ts` — CREAR
