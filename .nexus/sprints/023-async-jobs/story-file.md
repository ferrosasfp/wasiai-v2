# Story File — SDD #023: WAS-70 Async Jobs
**Sprint 13 | WAS-70**
**Classification: QUALITY — HU-MAJOR**
**Source of truth: this file only. Read every file before modifying.**

---

## Context

Vercel es serverless — requests tienen max 60s antes de timeout.
Pipelines complejos o agentes lentos no pueden responder en ese tiempo.
La solución: jobs asíncronos con Supabase como persistencia.

Arquitectura elegida: Supabase + polling (sin workers reales)
- POST /api/v1/jobs → inserta fila → retorna jobId inmediato
- Procesamiento ocurre non-blocking en la misma request donde sea posible
- GET /api/v1/jobs/:id → consulta Supabase → retorna estado

**KNOWN LIMITATION:** processJobAsync puede ser cortado por Vercel antes de completarse.
Jobs que queden en estado 'processing' por más de 5 minutos deben limpiarse via /admin/jobs/cleanup.

---

## Acceptance Criteria

- AC1: POST /api/v1/jobs retorna { jobId, status: "pending" } en < 500ms
- AC2: GET /api/v1/jobs/:id retorna { jobId, status, result?, error?, createdAt, completedAt? }
- AC3: Status values: pending | processing | completed | failed
- AC4: Migracion SQL incluida en el PR (tabla jobs con RLS)
- AC5: Jobs persisten minimo 7 dias en Supabase
- AC6: Job fallido muestra error descriptivo, no mensaje generico
- AC7: npx tsc --noEmit = 0 errores

---

## Wave 1 — Migracion SQL

Crear archivo: `supabase/migrations/027_async_jobs.sql`

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     UUID REFERENCES auth.users ON DELETE CASCADE,
  agent_slug  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','completed','failed')),
  input       JSONB,
  result      JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- RLS
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_jobs" ON jobs
  FOR ALL USING (auth.uid() = user_id);

-- Index para queries por user + status
CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_created_at  ON jobs(created_at DESC);

-- Auto-cleanup despues de 7 dias
-- (implementado via cron de Supabase o TTL policy)
```

---

## Wave 2 — API Routes

### POST /api/v1/jobs/route.ts (nuevo archivo)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { agent_slug, input } = body

  if (!agent_slug) return NextResponse.json({ error: 'agent_slug required' }, { status: 400 })

  // Insertar job en Supabase
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({ user_id: user.id, agent_slug, input, status: 'pending' })
    .select('id, status, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Iniciar procesamiento non-blocking (no await)
  processJobAsync(job.id, agent_slug, input, supabase).catch(console.error)

  return NextResponse.json({ jobId: job.id, status: job.status, createdAt: job.created_at })
}

async function processJobAsync(jobId: string, agentSlug: string, input: unknown, supabase: any) {
  try {
    await supabase.from('jobs').update({ status: 'processing', updated_at: new Date() }).eq('id', jobId)
    // TODO: llamar al agente real aqui
    const result = { output: 'placeholder — connect to agent invoke logic' }
    await supabase.from('jobs').update({
      status: 'completed', result, updated_at: new Date(), completed_at: new Date()
    }).eq('id', jobId)
  } catch (err: any) {
    await supabase.from('jobs').update({
      status: 'failed', error: err.message ?? 'Unknown error', updated_at: new Date(), completed_at: new Date()
    }).eq('id', jobId)
  }
}
```

### GET /api/v1/jobs/[id]/route.ts (nuevo archivo)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, status, result, error, created_at, updated_at, completed_at')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    result: job.result ?? undefined,
    error: job.error ?? undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at ?? undefined,
  })
}
```

---

## Wave 2.5 — Cleanup de jobs colgados

Agregar ruta: `src/app/api/v1/admin/jobs/cleanup/route.ts`

**Lógica:** marcar como `'failed'` cualquier job en estado `'processing'` con `updated_at` hace más de 5 minutos.
**Error message:** `"Job timed out — processing exceeded 5 minutes"`

Esta ruta se puede llamar manualmente o via Vercel cron (`vercel.json`).

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { verifyAdminSignature } from '@/lib/admin/verifyAdminSignature'

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdminSignature(req)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = createRouteHandlerClient({ cookies })

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'failed',
      error: 'Job timed out — processing exceeded 5 minutes',
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .lt('updated_at', fiveMinutesAgo)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ cleaned: data?.length ?? 0 })
}
```

**Cron opcional en vercel.json:**
```json
{
  "crons": [{
    "path": "/api/v1/admin/jobs/cleanup",
    "schedule": "*/10 * * * *"
  }]
}
```

---

## Wave 3 — TypeScript check

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit 2>&1
```

Debe ser 0 errores.

---

## Wave 4 — Commit + Push

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
git add src/app/api/v1/jobs/ supabase/migrations/027_async_jobs.sql
git commit -m "feat(WAS-70): async jobs API — POST /v1/jobs + GET /v1/jobs/:id + migration"
git push origin master master:main
```

---

## Critical Constraints

1. Lee TODOS los archivos existentes en src/app/api/v1/ antes de crear rutas nuevas
2. Si existe middleware de auth diferente al ejemplo, usarlo
3. El procesamiento non-blocking (processJobAsync sin await) puede ser cortado por Vercel si la request termina antes — esto es un known limitation documentado en el PR
4. Verificar si supabase/migrations/ existe — si no, crearlo
5. NO modificar rutas existentes de la API
