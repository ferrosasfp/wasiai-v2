# SDD WAS-282 — Detección de cuentas multi-alias (spam/bot)
**Clasificación:** HU-MINOR
**Archivos:**
- `supabase/migrations/NNN_add_account_status.sql` — nuevo enum + columna
- `src/app/api/v1/auth/agent-signup/route.ts` — check en registro (verificar si existe)
- `src/app/api/v1/agents/register/route.ts` — bloquear publicación si pending_review
- `src/app/api/creator/agents/[slug]/status/route.ts` — bloquear activación si pending_review

## Context
`oldlanguage75@agentmail.to` registró 3 cuentas con el mismo dominio en el mismo día y publicó 3 agentes rotos. No hay ningún mecanismo que detecte esto. `creator_profiles` no tiene campo de estado de cuenta.

**Decisiones aprobadas por PO:**
- Threshold: ≥ 3 cuentas del mismo dominio → `pending_review`
- Schema: ENUM `account_status` con valores `('active', 'pending_review', 'suspended')` DEFAULT `'active'`
- Dominios masivos (gmail, hotmail, outlook, yahoo, icloud, proton, me.com) → exentos del check
- Comportamiento retroactivo: NO — solo aplica a nuevos registros

## Acceptance Criteria
- AC1: WHEN se crea una cuenta con dominio que ya tiene ≥3 cuentas existentes THEN `account_status` se setea `pending_review`
- AC2: WHEN el dominio es de proveedor masivo conocido THEN el check no aplica y `account_status = 'active'`
- AC3: WHEN un creador con `account_status = 'pending_review'` intenta activar un agente THEN el sistema rechaza con 403 y mensaje claro
- AC4: WHEN un creador con `account_status = 'active'` opera THEN no hay cambio de comportamiento
- AC5: WHEN cuentas existentes tienen mismo dominio THEN NO se retroactivamente afectan

## Dominios masivos exentos (hardcoded)
```typescript
const BULK_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'hotmail.es', 'hotmail.co.uk',
  'outlook.com', 'outlook.es',
  'yahoo.com', 'yahoo.es', 'yahoo.co.uk',
  'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com',
  'live.com', 'msn.com',
])
```

## Wave 0 — Pre-flight
- [ ] `ls supabase/migrations/ | sort | tail -3` — número del siguiente migration
- [ ] Verificar si existe `src/app/api/v1/auth/agent-signup/route.ts`
- [ ] Leer `src/app/api/v1/agents/register/route.ts` — ver dónde se crea `creator_profiles`
- [ ] Leer `src/app/api/creator/agents/[slug]/status/route.ts` — ver dónde agregar el check
- [ ] Build gate: `npx tsc --noEmit 2>&1 | head -20`

## Wave 1 — Migration
**Archivo:** `supabase/migrations/NNN_add_account_status.sql`

```sql
-- WAS-282: account status + email_domain para detección de spam/multi-alias
CREATE TYPE account_status_enum AS ENUM ('active', 'pending_review', 'suspended');

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS account_status account_status_enum NOT NULL DEFAULT 'active';

-- email_domain: necesario para el conteo de cuentas por dominio sin queries a auth.users
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS email_domain TEXT;

-- Índices
CREATE INDEX IF NOT EXISTS creator_profiles_account_status_idx
  ON creator_profiles (account_status)
  WHERE account_status != 'active';

CREATE INDEX IF NOT EXISTS creator_profiles_email_domain_idx
  ON creator_profiles (email_domain);
```

**Build gate:** `npx tsc --noEmit`

## Wave 2 — Lógica de detección al registrar
**Archivo:** `src/app/api/v1/agents/register/route.ts` (en el bloque de creación de `creator_profiles`)

Agregar helper antes de la función principal:

```typescript
// WAS-282: Bulk email providers exempt from multi-alias check
const BULK_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'hotmail.co.uk',
  'outlook.com', 'outlook.es', 'yahoo.com', 'yahoo.es', 'yahoo.co.uk',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'live.com', 'msn.com',
])

async function resolveAccountStatus(
  email: string,
  userId: string,  // WAS-282: necesario para excluirse del conteo
  svc: ReturnType<typeof createServiceClient>,
): Promise<'active' | 'pending_review'> {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  if (!domain || BULK_EMAIL_PROVIDERS.has(domain)) return 'active'

  const { count } = await svc
    .from('creator_profiles')
    .select('id', { count: 'exact', head: true })
    .ilike('id', `%`)  // necesitamos join con auth.users — ver nota abajo

  // NOTA: creator_profiles no almacena el email directamente.
  // La detección debe hacerse via supabase.auth.admin.listUsers() filtrando por dominio,
  // o agregando una columna `email_domain` a creator_profiles en esta misma migration.
  // DECISIÓN: agregar `email_domain TEXT` a creator_profiles en Wave 1, popularlo en registro.

  // WAS-282: excluir el propio userId para evitar falsos positivos (bug off-by-one)
  // El perfil del usuario actual puede ya existir en DB si se creó antes del check
  const { count: domainCount } = await svc
    .from('creator_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('email_domain', domain)
    .neq('id', userId)  // no contar el propio perfil

  return (domainCount ?? 0) >= 3 ? 'pending_review' : 'active'
}
```

**NOTA para el Builder:** La migration de Wave 1 debe incluir también:
```sql
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS email_domain TEXT;
CREATE INDEX IF NOT EXISTS creator_profiles_email_domain_idx ON creator_profiles (email_domain);
```

Al crear el `creator_profile` en `register/route.ts`, agregar:
```typescript
email_domain: email.split('@')[1]?.toLowerCase() ?? null,
account_status: await resolveAccountStatus(email, userId, serviceClient),
```

**Build gate:** `npx tsc --noEmit`

## Wave 3 — Gate en activación de agente
**Archivo:** `src/app/api/creator/agents/[slug]/status/route.ts`

Después del ownership check y ANTES del probe de WAS-277, agregar:

```typescript
// WAS-282: block activation if creator account is pending_review
if (result.data.status === 'active') {
  const { data: profile } = await serviceClient
    .from('creator_profiles')
    .select('account_status')
    .eq('id', user.id)
    .single()

  if (profile?.account_status === 'pending_review') {
    return NextResponse.json(
      {
        error: 'Account pending review',
        code: 'account_pending_review',
        message: 'Your account is under review. Contact support to publish agents.',
      },
      { status: 403 },
    )
  }
}
```

**Build gate:** `npx tsc --noEmit`

## Rollback
```bash
git revert HEAD
# Migration down: DROP COLUMN email_domain, account_status; DROP TYPE account_status_enum
```

## Critical Constraints
- PROHIBIDO aplicar retroactivamente a cuentas existentes
- PROHIBIDO bloquear cuentas con dominios de la allowlist de proveedores masivos
- OBLIGATORIO que el check use `email_domain` (columna nueva) — no queries a `auth.users` por performance
- El threshold es **≥ 3** cuentas del mismo dominio (3 o más, no "más de 3")
