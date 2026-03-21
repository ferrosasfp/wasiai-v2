# SDD — WAS-246: POST /api/v1/onboard/{session_id} retorna 405

## Context

`POST /api/v1/onboard/start` crea una sesión y devuelve `session_id`. El usuario espera avanzar con `POST /api/v1/onboard/{session_id}`, pero ese archivo solo define GET → HTTP 405.

La lógica de avance está en `step/route.ts` (POST con `{session_id, answer}`). El fix: extraer lógica de step/route.ts a función shared, y agregar POST en [session_id]/route.ts que la invoca con el session_id de la URL.

La lógica de step/route.ts es grande (~200 líneas), no se duplica — se extrae.

## Acceptance Criteria
- AC-01: POST /api/v1/onboard/{session_id} con {answer} funciona igual que POST /step con {session_id, answer}
- AC-02: Session inválida → 404 {error: "Session not found or expired"}
- AC-03: POST /api/v1/onboard/step sigue funcionando (backward compat)
- AC-04: Sin duplicación — lógica en función exportada desde step/route.ts o lib compartida
- AC-05: POST /start responde con `next_url: "/api/v1/onboard/{session_id}"`
- AC-06: No nuevas dependencias npm

## Wave 0 — Pre-flight
- [ ] Leer los 3 archivos de onboard (ya leídos por SM): start, step, [session_id]
- [ ] Verificar que `processOnboardStep` no existe ya como export
- [ ] Verificar imports en step/route.ts para reusarlos en [session_id]/route.ts

## Wave 1 — Extraer lógica de step/route.ts

**Archivo:** `src/app/api/v1/onboard/step/route.ts`

Extraer la lógica del POST handler a una función exportada:

```typescript
// Al inicio del archivo (después de imports y QUESTIONS)
export async function processOnboardStep(session_id: string, answer: unknown): Promise<NextResponse> {
  // TODO: mover aquí el body de POST handler (sin el parsing JSON)
  // El POST handler queda como:
  // const { session_id, answer } = body
  // return processOnboardStep(session_id, answer)
}
```

El POST handler en step/route.ts pasa a ser:
```typescript
export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { session_id, answer } = body as { session_id?: string; answer?: unknown }
  if (!session_id) return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
  if (answer === null || answer === undefined || answer === '') {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 })
  }
  return processOnboardStep(session_id, answer)
}
```

**Build gate:** `npm run typecheck && npm run lint`

## Wave 2 — Agregar POST en [session_id]/route.ts

**Archivo:** `src/app/api/v1/onboard/[session_id]/route.ts`

Añadir POST handler que usa `processOnboardStep`:

```typescript
import { processOnboardStep } from '../step/route'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ session_id: string }> },
) {
  const { session_id } = await params
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { answer } = body as { answer?: unknown }
  if (answer === null || answer === undefined || answer === '') {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 })
  }
  return processOnboardStep(session_id, answer)
}
```

**Build gate:** `npm run typecheck && npm run lint`

## Wave 3 — Añadir next_url en start/route.ts

**Archivo:** `src/app/api/v1/onboard/start/route.ts`

```diff
  return NextResponse.json(
    {
      session_id: session.id,
+     next_url: `/api/v1/onboard/${session.id}`,
      step: 1,
      total_steps: 7,
      question: "What is your agent's name?",
      hint: 'Choose a descriptive name between 3 and 100 characters.',
    },
    { status: 201 },
  )
```

**Build gate:** `npm run typecheck && npm run lint`

## Rollback

`git revert <commit>` — 3 archivos, sin migración DB.

## Constraint Directives

- OBLIGATORIO: Extraer lógica en función named export (no duplicar)
- OBLIGATORIO: /step sigue funcionando como alias
- PROHIBIDO: modificar lógica del wizard (solo refactor + nuevo handler)
- PROHIBIDO: añadir nuevas dependencias

## Commit format

```
fix(WAS-246): POST /onboard/{session_id} — extract step logic, add REST-idiomatic handler
```
