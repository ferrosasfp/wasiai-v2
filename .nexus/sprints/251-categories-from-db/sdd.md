# SDD — WAS-251: Categorías desde DB (no hardcodeadas)

## Context
`processOnboardStep` step 4 valida contra `VALID_CATEGORIES = ['nlp','vision','audio','code','multimodal','data']`.
Las categorías reales en prod son: `['defi', 'defi-risk', 'security']` — completamente distintas.
Solución: crear tabla `agent_categories` con las categorías válidas y leerlas en runtime.

## Acceptance Criteria
- AC-01: `POST /api/v1/onboard/{session_id}` con `{"answer":"defi"}` en paso 4 → HTTP 200
- AC-02: `POST /api/v1/onboard/{session_id}` con `{"answer":"defi-risk"}` → HTTP 200
- AC-03: `POST /api/v1/onboard/{session_id}` con `{"answer":"invalid-cat"}` → HTTP 400
- AC-04: Agregar nueva categoría en DB → disponible en onboarding sin deploy
- AC-05: Build sin errores

## Wave 0 — Pre-flight
1. Leer `src/app/api/v1/onboard/step/route.ts` — localizar `VALID_CATEGORIES` y su uso en step 4
2. Leer `supabase/migrations/` — confirmar número de última migración (para crear 071 o 072)
3. Confirmar categorías reales en DB con query directa

## Wave 1 — Migración DB
Crear `supabase/migrations/072_agent_categories.sql`:
```sql
-- 072_agent_categories.sql
CREATE TABLE IF NOT EXISTS agent_categories (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed inicial (todas las categorías existentes + hardcodeadas)
INSERT INTO agent_categories (slug, label) VALUES
  ('nlp',        'Natural Language Processing'),
  ('vision',     'Computer Vision'),
  ('audio',      'Audio Processing'),
  ('code',       'Code & Development'),
  ('multimodal', 'Multimodal'),
  ('data',       'Data & Analytics'),
  ('defi',       'DeFi'),
  ('defi-risk',  'DeFi Risk Analysis'),
  ('security',   'Security & Audit')
ON CONFLICT (slug) DO NOTHING;

-- RLS: lectura pública, escritura solo service_role
ALTER TABLE agent_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_categories_read" ON agent_categories FOR SELECT USING (true);
```

Aplicar con Supabase management API.

## Wave 2 — Actualizar validación en step 4
En `src/app/api/v1/onboard/step/route.ts`:

1. Eliminar `const VALID_CATEGORIES = [...]` y el tipo `Category`
2. En `case 4:` — query a `agent_categories` para obtener slugs activos:
```typescript
case 4: {
  if (typeof answer !== 'string') {
    return NextResponse.json({ error: 'Category must be a string' }, { status: 400 })
  }
  const { data: cats } = await serviceClient
    .from('agent_categories')
    .select('slug')
    .eq('is_active', true)
  const validSlugs = (cats ?? []).map(c => c.slug)
  if (!validSlugs.includes(answer)) {
    return NextResponse.json(
      { error: `Category must be one of: ${validSlugs.join(', ')}` },
      { status: 400 }
    )
  }
  data.category = answer
  break
}
```

3. Actualizar hint del step 4 en `QUESTIONS` para no listar categorías hardcodeadas:
```typescript
4: { question: "What category does your agent belong to?", hint: 'e.g. defi, nlp, vision, code, data, security' },
```

**Build gate:** `npm run typecheck && npm run lint`

## Rollback
`git revert HEAD` — restaura validación hardcodeada. La migración es additive (no rompe nada).

## Critical Constraints
- NO hardcodear categorías en código — siempre desde DB
- `serviceClient` para el query (no anon client)
- Si DB query falla → fallback a error 503, NO a lista hardcodeada
