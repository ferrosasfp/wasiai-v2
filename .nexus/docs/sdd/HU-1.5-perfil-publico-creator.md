# SDD — HU-1.5: Perfil Público del Creator

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-25
> **HU origen:** `.nexus/docs/prd/HU-1.5-perfil-publico-creator.md`
> **Linear:** WAS-9 · **Sprint:** 2

---

## Objetivo
Crear una página pública `/creator/[username]` que muestre el perfil del creator con todos sus agentes activos. Agregar columna `username` a `creator_profiles`. Linkear nombre del creator en la ficha del agente.

---

## Rutas / Endpoints

| Ruta | Auth | Descripción |
|------|------|-------------|
| `/[locale]/creator/[username]` | ❌ pública | Perfil del creator — ISR 600s |

Sin nuevos API endpoints — todo corre server-side como Server Component.

---

## Schema DB — Migration 016 (compartida con HU-3.1)

```sql
-- Columna username en creator_profiles
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- Índice único case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_profiles_username_lower
  ON creator_profiles (LOWER(username));

-- Backfill: generar username desde email para perfiles existentes
-- Formato: parte antes del @, lowercase, sin caracteres especiales, max 30 chars
-- Si colisión → añadir sufijo -2, -3, etc.
UPDATE creator_profiles cp
SET username = (
  SELECT REGEXP_REPLACE(
    LOWER(SPLIT_PART(u.email, '@', 1)),
    '[^a-z0-9_]', '', 'g'
  )
  FROM auth.users u WHERE u.id = cp.user_id
)
WHERE username IS NULL;
```

> **Nota:** El backfill puede tener colisiones. Para el MVP con < 10 usuarios es aceptable resolverlo manualmente si ocurre. La constraint UNIQUE detectará el problema en el apply.

**Campo `bio`:** Columna TEXT nullable. El creator puede editarla desde settings (fuera de scope de esta HU — aquí es solo lectura).

---

## Implementación — Backend (Server Component)

### `src/app/[locale]/creator/[username]/page.tsx` — NUEVO

```typescript
export const revalidate = 600  // ISR 10 min

interface Props {
  params: { locale: string; username: string }
}

export async function generateMetadata({ params }: Props) {
  const creator = await getCreatorByUsername(params.username)
  if (!creator) return { title: 'Creator no encontrado — WasiAI' }
  return {
    title: `${creator.displayName} — Creator en WasiAI`,
    description: creator.bio
      ?? `Descubre los agentes de ${creator.displayName} en WasiAI`,
  }
}

export default async function CreatorProfilePage({ params }: Props) {
  const creator = await getCreatorByUsername(params.username)
  if (!creator) notFound()
  return <CreatorProfileView creator={creator} />
}
```

### `src/features/creator/lib/getCreatorByUsername.ts` — NUEVO

```typescript
export interface CreatorProfile {
  username: string
  displayName: string        // username o parte del email
  bio: string | null
  memberSince: string        // created_at ISO
  agentCount: number
  totalCalls: number
  agents: AgentCard[]        // agentes activos con datos para card
}

export async function getCreatorByUsername(
  username: string
): Promise<CreatorProfile | null> {
  const supabase = createServiceClient()

  // 1. Buscar creator por username (case-insensitive)
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('id, username, bio, user_id, created_at')
    .ilike('username', username)
    .single()

  if (!profile) return null

  // 2. Agentes activos del creator
  const { data: agents } = await supabase
    .from('agents')
    .select('id, slug, name, description, price_usdc, category, image_url')
    .eq('creator_id', profile.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  // 3. Total de llamadas (suma de todas las keys del creator)
  const agentIds = (agents ?? []).map(a => a.id)
  let totalCalls = 0
  if (agentIds.length > 0) {
    const { count } = await supabase
      .from('agent_calls')
      .select('id', { count: 'exact', head: true })
      .in('agent_id', agentIds)
    totalCalls = count ?? 0
  }

  // 4. displayName: username > email prefix
  // NO exponer email completo ni wallet_address
  const displayName = profile.username ?? 'Creator'

  return {
    username: profile.username,
    displayName,
    bio: profile.bio,
    memberSince: profile.created_at,
    agentCount: agents?.length ?? 0,
    totalCalls,
    agents: agents ?? [],
  }
}
```

---

## Implementación — Frontend

### `src/features/creator/components/CreatorProfileView.tsx` — NUEVO

**Layout:**
```
<main>
  ├── <CreatorHeader />        — avatar (inicial), nombre, bio, stats pills
  └── <AgentGrid />            — cards clicables → ficha del agente
```

**`CreatorHeader`:**
```typescript
// Avatar: círculo con inicial del displayName, fondo Avalanche red
// Stats pills: "{agentCount} agentes", "{totalCalls} llamadas", "Desde {año}"
// Bio: si null → no mostrar espacio vacío
```

**`AgentGrid`:**
```typescript
// Reusar <AgentCard /> existente (mismas props, misma visual que marketplace)
// Grid: 1 col mobile, 2 col tablet, 3 col desktop
// Si agents.length === 0:
//   <EmptyState message="Este creator aún no ha publicado agentes." />
```

### `src/app/[locale]/agents/[slug]/page.tsx` — MODIFICAR
Agregar link del nombre del creator a su perfil:
```typescript
// Donde se muestra el creator name, añadir:
<Link href={`/${locale}/creator/${agent.creatorUsername}`}>
  {agent.creatorDisplayName}
</Link>
```

Para esto, la query de la ficha del agente debe hacer JOIN con `creator_profiles` para traer `username`. Modificar `getAgentBySlug` (o equivalente) para incluir el username del creator.

---

## i18n

Agregar a `en.json` y `es.json`:
```json
{
  "creator_profile": {
    "agents_count": "{count} agentes",
    "calls_count": "{count} llamadas",
    "member_since": "Desde {year}",
    "no_agents": "Este creator aún no ha publicado agentes.",
    "not_found": "Creator no encontrado.",
    "back_to_marketplace": "← Volver al marketplace"
  }
}
```

---

## Migration 016 — Contenido completo (HU-3.1 + HU-1.5)

El archivo `016_username_trials.sql` incluye **ambas** HUs:

```sql
-- HU-1.5: username en creator_profiles
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_profiles_username_lower
  ON creator_profiles (LOWER(username));

-- Backfill usernames
UPDATE creator_profiles cp
SET username = (
  SELECT REGEXP_REPLACE(
    LOWER(SPLIT_PART(u.email, '@', 1)),
    '[^a-z0-9_]', '', 'g'
  )
  FROM auth.users u WHERE u.id = cp.user_id
)
WHERE username IS NULL;

-- HU-3.1: is_trial en agent_calls
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE;

-- HU-3.1: tabla agent_trials
CREATE TABLE IF NOT EXISTS agent_trials (
  id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, agent_id)
);

ALTER TABLE agent_trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_sees_own_trials" ON agent_trials
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_agent_trials_user_agent
  ON agent_trials (user_id, agent_id);
```

---

## Edge Cases

| Caso | Comportamiento |
|------|----------------|
| Username no existe | `notFound()` → Next.js 404 automático |
| Username con mayúsculas en URL | `ilike` en query → case-insensitive |
| Creator sin agentes activos | AgentGrid empty state |
| Bio null | Header sin sección bio (sin espacio vacío) |
| Email con caracteres especiales | `REGEXP_REPLACE` limpia a `[a-z0-9_]` |
| Username colisión en backfill | La constraint UNIQUE falla → resolver manual en Supabase dashboard |
| Creator con wallet | No se expone wallet_address en ningún punto de la página pública |

---

## Definition of Done

- [ ] Migration 016 aplicada en Supabase prod (username + bio + agent_trials + is_trial)
- [ ] Backfill de usernames existentes correcto
- [ ] `getCreatorByUsername` query correcta — no expone email ni wallet
- [ ] `/creator/[username]` renderiza correctamente
- [ ] 404 si username no existe
- [ ] Link desde ficha del agente al perfil del creator
- [ ] `generateMetadata` con title y description reales
- [ ] ISR 600s configurado
- [ ] Grid de agent cards usando componente existente
- [ ] i18n en/es
- [ ] `npm run build` limpio
- [ ] Adversarial review (foco: no filtrar email/wallet en respuesta pública)
- [ ] AC1–AC7 verificados

---

*SPEC_APPROVED — Sprint 2, 2026-02-25*
