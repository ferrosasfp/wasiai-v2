# SDD — HU-1.2: Formulario multi-paso con preview live

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-25
> **HU origen:** `.nexus/docs/prd/HU-1.2-formulario-multipaso.md`
> **Linear:** WAS-6 · **Sprint:** 1

---

## Objetivo

Reemplazar el formulario `/publish` de una sola pantalla por un stepper de 3 pasos con preview live del AgentCard, auto-guardado como borrador y carga de drafts previos.

---

## Rutas / Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/models` | ✅ | Ya existe. Agregar: campo `status: 'draft' \| 'active'` (default `'active'`) |
| `PATCH` | `/api/creator/agents/[slug]` | ✅ | Ya existe. Sin cambios |
| `PATCH` | `/api/creator/agents/[slug]/status` | ✅ | Ya existe. Agregar `'draft'` como valor. **Mover `registerAgentOnChain` aquí — solo cuando status → `'active'`** |
| `DELETE` | `/api/creator/agents/[slug]` | ✅ | Ya existe (soft-delete). Usar para "Descartar borrador" |

---

## Schema de DB

**Sin migration.** `status` es TEXT sin enum — `'draft'` es válido.

RLS existente cubre correctamente:
- `agents_public_read`: `status = 'active'` → drafts no visibles públicamente ✅
- `agents_creator_manage`: `creator_id = auth.uid()` → creator lee sus propios drafts ✅

**Cambio en `POST /api/models`:**
- Agregar `status?: 'draft' | 'active'` al `createModelSchema` en `model.schema.ts`
- **Mover `registerAgentOnChain`** del POST al PATCH `/status` cuando `status → 'active'`

---

## Interacciones on-chain

`registerAgentOnChain` se mueve de `POST /api/models` a `PATCH /api/creator/agents/[slug]/status` cuando `status === 'active'`. Evita registros on-chain de drafts que nunca se publican.

Sin cambio de contrato. Sin redeploy.

---

## Componentes UI

**`src/app/[locale]/publish/PublishForm.tsx`** — REFACTORIZAR (Client Component)

Estado interno:
```typescript
type PublishState = {
  step: 1 | 2 | 3
  data: Partial<CreateModelDraft>
  draftSlug: string | null   // null = aún no guardado en DB
  saving: boolean
  errors: Record<string, string>
}
```

Layout:
```
<PublishForm>
  <StepIndicator currentStep={step} />
  <div class="grid lg:grid-cols-[1fr,320px] gap-6">
    <Step1 | Step2 | Step3 />
    <AgentCardPreview data={data} />     // sticky en desktop, abajo en mobile
  </div>
</PublishForm>
```

**`src/components/publish/StepIndicator.tsx`** — NUEVO
- Props: `{ currentStep: 1 | 2 | 3 }`
- Pasos: "Básico", "Producto", "Técnico"

**`src/components/publish/Step1Basic.tsx`** — NUEVO
- Campos: `name`, `description`, `category` (select), `cover_image` (upload via `useFileUpload`)
- Validación: `name` required, `category` required

**`src/components/publish/Step2Product.tsx`** — NUEVO
- Campos: `price_per_call` (USDC), `base_model`, `capabilities` (JSON textarea)
- Validación: `price_per_call` > 0

**`src/components/publish/Step3Technical.tsx`** — NUEVO
- Campos: `endpoint_url`, `auth_header` (opcional), `http_method` (GET/POST)
- Validación: `endpoint_url` required

**`src/components/publish/AgentCardPreview.tsx`** — NUEVO
- Props: `{ data: Partial<CreateModelDraft> }`
- Basado en `ModelCard` pero sin `Link`, sin métricas, con datos parciales
- Precio: `data.price_per_call ? "${price} USDC/call" : "— USDC/call"`
- Label "Preview" en esquina superior derecha

---

## Flujos

### Happy Path — Nuevo agente

```
1. /publish → sin borrador → formulario vacío
2. Paso 1: nombre + desc + categoría + imagen
   click "Siguiente" → validar → POST /api/models { ...step1, status: 'draft' }
   → guardar draftSlug en state
3. Paso 2: precio + capabilities
   click "Siguiente" → validar → PATCH /api/creator/agents/[draftSlug] { ...step2 }
4. Paso 3: endpoint_url
   click "Publicar" → validar →
     PATCH /api/creator/agents/[draftSlug] { ...step3 }
     PATCH /api/creator/agents/[draftSlug]/status { status: 'active' }
       → registerAgentOnChain() ejecutado aquí
   → redirect /creator/dashboard (o /onboarding si from=onboarding)
```

### Happy Path — Retomar borrador

```
1. /publish → Server Component detecta agent status='draft' del creator
2. Modal: "Tienes un borrador sin publicar — ¿Continuar o Descartar?"
3a. Continuar → PublishForm recibe initialDraft → carga datos
    Paso inferido: endpoint_url existe → paso 3; price_per_call → paso 2; solo name → paso 1
3b. Descartar → DELETE /api/creator/agents/[draftSlug] → formulario vacío
```

### Edge Cases

| Caso | Comportamiento |
|------|----------------|
| Navegar atrás desde paso 2 | Datos en state, no hace PATCH |
| POST draft falla (slug duplicado) | Error inline en `name`, no navega |
| PATCH falla al publicar | Error toast, agente queda 'draft' |
| `registerAgentOnChain` falla | Agente activo en DB, log de error, cron reintenta |
| Cover image falla | Error inline, no bloquea avanzar (imagen opcional) |
| Precio vacío en preview paso 1 | Muestra "— USDC/call" |
| Creator sin wallet publica | `registerAgentOnChain` no se ejecuta (sin wallet). Agente publicado en DB. Settlement de llamadas via cron con pending_earnings_usdc (HU-1.1) |

---

## Cambios en código existente

**`src/lib/schemas/model.schema.ts`**
```typescript
export const createModelSchema = z.object({
  // ... campos existentes sin cambios
  status: z.enum(['draft', 'active']).optional().default('active'),
})
```

**`src/app/api/models/route.ts`** (POST)
```typescript
// QUITAR registerAgentOnChain de aquí (mover a status route)
// El resto sin cambios — status viene del body validado
```

**`src/app/api/creator/agents/[slug]/status/route.ts`** (PATCH)
```typescript
// Agregar 'draft' al enum de valores aceptados
const statusSchema = z.object({
  status: z.enum(['active', 'paused', 'draft']),
})

// Cuando status === 'active': llamar registerAgentOnChain (fire-and-forget)
if (result.data.status === 'active') {
  const { data: profile } = await supabase
    .from('creator_profiles').select('wallet_address').eq('id', user.id).single()
  if (profile?.wallet_address) {
    registerAgentOnChain(slug, profile.wallet_address).catch(err =>
      console.error('[status] registerAgentOnChain failed:', err)
    )
  }
}
```

**`src/app/[locale]/publish/page.tsx`** (Server Component)
```typescript
// Detectar borrador del creator
const { data: draft } = await supabase
  .from('agents').select('*')
  .eq('creator_id', user.id).eq('status', 'draft')
  .order('updated_at', { ascending: false }).limit(1).maybeSingle()

// Pasar como prop
return <PublishForm initialDraft={draft} from={searchParams.from} />
```

---

## i18n — Claves nuevas

```json
{
  "publish": {
    "steps": { "basic": "Básico", "product": "Producto", "technical": "Técnico" },
    "preview": { "label": "Vista previa", "pricePlaceholder": "— USDC/call" },
    "draftModal": {
      "title": "Tienes un borrador sin publicar",
      "cta": "Continuar borrador",
      "discard": "Descartar y empezar de nuevo"
    },
    "cta": { "next": "Siguiente", "back": "Atrás", "publish": "Publicar agente" }
  }
}
```

---

## Definition of Done

- [ ] Stepper 3 pasos con navegación libre sin perder datos
- [ ] Preview live actualiza en tiempo real (nombre, desc, precio, categoría, imagen)
- [ ] Precio muestra "— USDC/call" hasta que se define en paso 2
- [ ] Auto-guardado `status='draft'` al pasar paso 1 → 2
- [ ] PATCH actualiza draft al pasar paso 2 → 3
- [ ] Click "Publicar" → `status='active'` + `registerAgentOnChain`
- [ ] `registerAgentOnChain` movido del POST al PATCH status → 'active'
- [ ] Carga borrador previo con modal continuar/descartar
- [ ] Inferencia de paso del borrador: endpoint_url→3, price→2, name→1
- [ ] Drafts no visibles en marketplace (RLS existente)
- [ ] Creator sin wallet: agente se publica en DB, sin registro on-chain
- [ ] Claves i18n en `es.json` + `en.json`
- [ ] `npm run build` limpio — 0 errores TS, 0 ESLint
- [ ] Adversarial review pasado
- [ ] AC1 a AC7 verificados manualmente

---

## Assumptions

- `status='draft'` es válido en DB (TEXT sin enum) — sin migration.
- `ModelCard` se usa como base para `AgentCardPreview` sin modificarlo.
- `useFileUpload` hook reutilizable sin cambios.
- Solo 1 draft activo por creator identificado por `creator_id + status='draft'`.
- Creator sin wallet publica en DB sin registro on-chain — consistente con HU-1.1.

---

*SPEC_APPROVED por Fer — 2026-02-25*
