# SDD — HU-1.1: Onboarding sin fricción para creators

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-25
> **HU origen:** `.nexus/docs/prd/HU-1.1-onboarding-sin-friccion.md`
> **Linear:** WAS-5 · **Sprint:** 1

---

## Objetivo

Permitir que un creator nuevo se registre con email y publique su primer agente sin necesitar wallet ni USDC, con un wizard de 3 pasos que guía el proceso completo.

---

## Rutas / Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/[locale]/onboarding` | ✅ | Wizard 3 pasos. Redirect a `/login` si no hay sesión |
| `PATCH` | `/api/creator/profile` | ✅ | Actualiza `display_name` + `bio` + `onboarding_step`. Rate limiting Upstash |
| `POST` | `/api/creator/wallet` | ✅ | Ya existe. Agregar: trigger settlement inmediato al guardar wallet |
| `GET` | `/api/creator/withdraw` | ✅ | Ya existe. Agregar: guard 400 si `wallet_address IS NULL` |

---

## Schema de DB

**Migration `015_onboarding-fields.sql`:**
```sql
ALTER TABLE creator_profiles
  ADD COLUMN pending_earnings_usdc  numeric(20,6)  NOT NULL DEFAULT 0,
  ADD COLUMN onboarding_completed   boolean        NOT NULL DEFAULT false,
  ADD COLUMN onboarding_step        int            NOT NULL DEFAULT 1;

COMMENT ON COLUMN creator_profiles.pending_earnings_usdc IS
  'Display counter: suma de earnings no liquidados por falta de wallet.
   El USDC real está en escrow del contrato. Se liquida en próximo cron
   (o settlement inmediato) una vez wallet configurada.';
```

RLS: hereda la policy existente de `creator_profiles` (`user_id = auth.uid()`). Sin cambios adicionales.

---

## Interacciones on-chain

**Sin cambio de contrato.** Mecanismo Opción A:

- Si `creator.wallet_address IS NULL` → cron **skipea** settlement on-chain, incrementa `pending_earnings_usdc`.
- El USDC queda en escrow de la key hasta que el creator configura wallet.
- Al configurar wallet (`POST /api/creator/wallet`): settlement inmediato de sus llamadas pendientes.
  - Obtener todos los slugs de agentes del creator → para cada slug, obtener `agent_calls` no liquidadas → `settleKeyBatch` on-chain por slug.
  - Si falla on-chain: log error, **no** hacer rollback del `wallet_address`. El cron diario resuelve.
- Delay máximo para cobrar tras configurar wallet: **0h** (settlement inmediato).

---

## Componentes UI

**`src/app/[locale]/onboarding/page.tsx`** — Server Component
- Lee `onboarding_step` y `onboarding_completed` de `creator_profiles`
- Si `onboarding_completed = true` → redirect `/[locale]/creator/dashboard`
- Si `?published=true` en searchParams → ejecuta Server Action para actualizar `onboarding_step = 3`, luego renderiza paso 3
- Renderiza `<OnboardingStep1 | 2 | 3>` según `onboarding_step`

> ⚠️ **Nota de implementación:** El update de `onboarding_step` al detectar `?published=true` se hace via **Server Action** invocada desde el Server Component — no en Client Component ni con side-effects de render. Esto garantiza que la mutación ocurra antes de renderizar el paso 3.

**`OnboardingStep1`** — `src/components/onboarding/OnboardingStep1.tsx`
- Client Component
- Inputs: `display_name` (required), `bio` (optional, max 160 chars)
- Submit → `PATCH /api/creator/profile` con `{ display_name, bio, onboarding_step: 2 }` → navega a paso 2
- Prefill con datos existentes

**`OnboardingStep2`** — `src/components/onboarding/OnboardingStep2.tsx`
- Server Component
- Copy: "Tu agente en el marketplace en minutos"
- CTA primario: `<Link href="/[locale]/publish?from=onboarding">Publicar agente</Link>`
- CTA secundario: Server Action `setOnboardingStep(3)` → re-render paso 3
- En `/publish`: al completar exitosamente → `redirect('/[locale]/onboarding?published=true')`

**`OnboardingStep3`** — `src/components/onboarding/OnboardingStep3.tsx`
- Client Component
- Reutiliza `<WalletSetup />` existente
- Badge "Opcional" visible
- CTA "Ir al dashboard" → Server Action `completeOnboarding()` → redirect dashboard
- Al completar `WalletSetup` → Server Action `completeOnboarding()` → redirect dashboard

**`PendingEarningsBanner`** — `src/components/PendingEarningsBanner.tsx`
- Se muestra en `/creator/dashboard` si `pending_earnings_usdc > 0` AND `wallet_address IS NULL`
- Copy (i18n key `dashboard.pendingEarnings`): "Tienes {amount} USDC pendientes — configura tu wallet para cobrarlos"
- CTA: "Configurar wallet" → abre `WalletSetup` modal

**Redirect guard** — `src/app/[locale]/creator/dashboard/page.tsx`
- Server Component: si `onboarding_completed = false` → `redirect('/[locale]/onboarding')`

---

## Flujos

### Happy Path — Creator sin wallet

```
1. /register → Supabase Auth → callback → trigger crea creator_profiles
   { onboarding_completed: false, onboarding_step: 1 }
2. Redirect → /[locale]/onboarding (paso 1)
3. display_name + bio → PATCH /api/creator/profile { onboarding_step: 2 }
4. Paso 2: click "Publicar agente" → /publish?from=onboarding
5. Completa /publish → redirect /[locale]/onboarding?published=true
6. Server Action actualiza onboarding_step = 3 → renderiza paso 3
7. Click "Ir al dashboard" → completeOnboarding() → /creator/dashboard
```

### Happy Path — Creator configura wallet después

```
1. Dashboard → PendingEarningsBanner → "Configurar wallet"
2. WalletSetup → POST /api/creator/wallet
3. Settlement inmediato: slugs del creator → settleKeyBatch on-chain
4. pending_earnings_usdc = 0 → banner desaparece
5. Earnings on-chain disponibles para withdraw
```

### Edge Cases

| Caso | Comportamiento |
|------|----------------|
| Refresca en mitad del wizard | Server Component lee `onboarding_step` de DB → paso correcto |
| Va directo a `/creator/dashboard` sin completar | Redirect a `/onboarding` |
| Ya completó onboarding, vuelve a `/onboarding` | Redirect a `/creator/dashboard` |
| Invocación antes de configurar wallet | Cron skipea, incrementa `pending_earnings_usdc` |
| Withdraw sin wallet | 400: `{ error: "Configura tu wallet para retirar", action: "setup_wallet" }` |
| Settlement inmediato falla al configurar wallet | Log error, wallet_address se guarda igual. Cron diario resuelve |
| Creator salta paso 2 (no publica) | CTA secundario → `onboarding_step = 3`, puede publicar luego desde dashboard |

---

## Cambios en código existente

### `src/app/api/cron/settle-key-batches/route.ts`
```typescript
// ANTES de intentar settleKeyBatch on-chain para cada creator:
const { data: creator } = await supabase
  .from('creator_profiles')
  .select('wallet_address')
  .eq('user_id', creatorUserId)
  .single()

if (!creator?.wallet_address) {
  // Acumular en pending_earnings_usdc
  await supabase.rpc('increment_pending_earnings', {
    p_user_id: creatorUserId,
    p_amount: totalAmount,
  })
  continue // skip on-chain
}
```

### `src/app/api/creator/wallet/route.ts` (POST)
```typescript
// DESPUÉS de guardar wallet_address exitosamente:
// Trigger settlement inmediato (fire-and-forget con log de error)
triggerImmediateSettlement(userId, walletAddress).catch(err =>
  console.error('[wallet] immediate settlement failed:', err)
)
```

### `src/app/api/creator/withdraw/route.ts`
```typescript
// INICIO del handler:
if (!creatorProfile.wallet_address) {
  return NextResponse.json(
    { error: 'Configura tu wallet para retirar', action: 'setup_wallet' },
    { status: 400 }
  )
}
```

### `src/app/[locale]/publish/page.tsx`
```typescript
// EN el redirect de éxito del formulario:
const from = searchParams.get('from')
redirect(from === 'onboarding'
  ? `/${locale}/onboarding?published=true`
  : `/${locale}/creator/dashboard`
)
```

---

## i18n — Claves nuevas requeridas

```json
// messages/es.json y messages/en.json — agregar en sección "onboarding":
{
  "onboarding": {
    "step1": { "title": "...", "subtitle": "...", "cta": "..." },
    "step2": { "title": "...", "subtitle": "...", "cta": "...", "skip": "..." },
    "step3": { "title": "...", "subtitle": "...", "cta": "...", "skip": "..." }
  },
  "dashboard": {
    "pendingEarnings": "Tienes {amount} USDC pendientes — configura tu wallet para cobrarlos",
    "pendingEarningsCta": "Configurar wallet"
  }
}
```

---

## Definition of Done

- [ ] Migration `015_onboarding-fields.sql` aplicada en Supabase (local + prod)
- [ ] `PATCH /api/creator/profile` creado con Upstash rate limiting
- [ ] RPC `increment_pending_earnings` creada en Supabase (o inline SQL via service client)
- [ ] Wizard `/onboarding` funciona en los 3 pasos completos
- [ ] Creator puede publicar desde el wizard sin wallet configurada
- [ ] `pending_earnings_usdc` se incrementa cuando cron skipea por falta de wallet
- [ ] Al configurar wallet → settlement inmediato de llamadas pendientes
- [ ] `PendingEarningsBanner` aparece/desaparece según estado
- [ ] Guard 400 en `/api/creator/withdraw` si `wallet_address IS NULL`
- [ ] Redirect `/creator/dashboard` → `/onboarding` si `onboarding_completed = false`
- [ ] Claves i18n nuevas en `es.json` + `en.json`
- [ ] `npm run build` limpio — 0 errores TS, 0 warnings ESLint
- [ ] Sin hardcodes de addresses ni amounts
- [ ] Adversarial review pasado
- [ ] AC1 a AC7 verificados manualmente en local

---

## Assumptions

- Trigger `handle_new_user()` ya crea `creator_profiles` en signup.
- `WalletSetup` component ya existe y funciona — se reutiliza sin cambios.
- Formulario `/publish` ya funciona — no se modifica en esta HU (solo el redirect de éxito).
- Cron `settle-key-batches` ya tiene acceso a `creator_profiles.wallet_address`.
- `settleKeyBatch` del contrato acepta llamadas con array vacío sin revertir.

---

*SPEC_APPROVED por Fer — 2026-02-25*
