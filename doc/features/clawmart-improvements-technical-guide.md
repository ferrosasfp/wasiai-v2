# WasiAI v2 — Guía Técnica de Mejoras Inspiradas en ClawMart

**Autor:** Auditor de Producto WasiAI
**Fecha:** 2026-03-05
**Propósito:** Recomendaciones técnicas detalladas para 7 mejoras de producto, respetando el stack y golden path actual.

> ⚠️ Este documento es la fuente de verdad técnica para cada mejora.
> El código de referencia está basado en el estado actual post-security-fixes.
> Stack: Next.js 16 + React 19 + Supabase + Viem v2 + Foundry + OpenZeppelin.

---

## Golden Path — Respetar Siempre

| Regla | Implementación actual |
|-------|----------------------|
| i18n obligatorio | `messages/en.json` + `messages/es.json` via next-intl. Toda string visible → key i18n |
| Zod en inputs | Todos los endpoints validan con Zod antes de procesar |
| RLS activo | `createClient()` en pages/components, `createServiceClient()` solo en cron/admin |
| ISR/revalidate | Landing 300s, transparency 60s. Páginas nuevas deben especificar revalidate |
| Feature-first | Componentes en `src/features/`, pages en `src/app/[locale]/` |
| Fire-and-forget | DB inserts de logging no bloquean response |
| Atomic money ops | `check_and_deduct_budget` RPC pattern — toda operación de dinero atómica |
| SSRF gate | `validateEndpointUrlAsync()` antes de fetch a URLs externas |
| Sin hardcodes | Addresses, URLs, keys → env vars |
| viem v2 | Sin ethers.js. Pinned 2.21.0 |

---

## MEJORA 1 — Free Trial Visible en Marketplace

**Clasificación NexusAgile:** FAST
**Archivos:** 3 archivos, ~40 líneas

### Contexto actual

- `agents.free_trial_enabled` (boolean) — ya existe en BD
- `agents.free_trial_limit` (integer, max 10) — ya existe
- `FreeTrialToggle` — componente en creator dashboard, funcional
- `agent_trials` — tabla de tracking (1 trial por user/agent)
- La lógica de trial en invoke endpoint **ya funciona**
- **Lo que falta:** No se muestra en las cards del marketplace ni hay filtro

### Solución

**A) ModelCard.tsx — Agregar badge de free trial:**

Archivo: `src/features/models/components/ModelCard.tsx`

Actualmente el card muestra: nombre, categoría, precio, tipo, badges on-chain/ERC-8004.
Agregar badge condicional:

```typescript
{/* Después del badge de precio, antes del CTA */}
{model.free_trial_enabled && (
  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
    🆓 {t('marketplace.freeTrial', { count: model.free_trial_limit })}
  </span>
)}
```

**B) Landing page — Sección "Free to Try":**

Archivo: `src/app/[locale]/page.tsx`

Agregar query para agentes con trial activo, después de la sección principal:

```typescript
// Query agentes con free trial
const { data: freeTrialAgents } = await supabase
  .from('agents')
  .select('id, name, slug, description, category, price_per_call, free_trial_enabled, free_trial_limit, total_calls')
  .eq('status', 'active')
  .eq('free_trial_enabled', true)
  .order('total_calls', { ascending: false })
  .limit(6);
```

Renderizar como sección horizontal con título i18n:
```typescript
{freeTrialAgents && freeTrialAgents.length > 0 && (
  <section className="mt-12">
    <h2 className="text-xl font-bold mb-4">{t('home.freeToTry')}</h2>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {freeTrialAgents.map((agent, i) => (
        <ModelCard key={agent.id} model={agent} locale={locale} index={i} />
      ))}
    </div>
  </section>
)}
```

**C) SearchBar/FilterPanel — Filtro "Free to Try":**

Archivo: `src/features/models/components/SearchBar.tsx`

Agregar checkbox o toggle en el panel de filtros:
```typescript
// Nuevo query param: ?free_trial=true
const freeTrialParam = searchParams.get('free_trial');

// En la query de agentes del landing:
if (freeTrialParam === 'true') {
  query = query.eq('free_trial_enabled', true);
}
```

**D) i18n keys:**
```json
{
  "home": {
    "freeToTry": "Free to Try",
    "freeToTryEs": "Prueba Gratis"
  },
  "marketplace": {
    "freeTrial": "Try Free · {count} calls",
    "freeTrialFilter": "Free to Try",
    "freeTrialEs": "Prueba Gratis · {count} llamadas",
    "freeTrialFilterEs": "Prueba Gratis"
  }
}
```

---

## MEJORA 2 — Social Proof (Calls + Trending + Badges)

**Clasificación NexusAgile:** FAST
**Archivos:** 3-4 archivos, ~60 líneas

### Contexto actual

- `agents.total_calls` — ya existe y se incrementa en cada invoke
- `agents.total_revenue` — ya existe
- `creator_profiles.verified` — ya existe (boolean)
- `ModelCard.tsx` — muestra categoría y precio, pero NO calls ni popularity
- Landing page — muestra grid genérico, sin secciones curadas

### Solución

**A) ModelCard.tsx — Mostrar total_calls:**

```typescript
{/* Agregar en el footer del card, antes del precio */}
<div className="flex items-center gap-2 text-xs text-muted-foreground">
  {model.total_calls > 0 && (
    <span className="flex items-center gap-1">
      <span>🔥</span>
      {model.total_calls >= 1000
        ? `${(model.total_calls / 1000).toFixed(1)}k`
        : model.total_calls} {t('marketplace.calls')}
    </span>
  )}
</div>
```

**B) Landing page — Secciones curadas:**

Archivo: `src/app/[locale]/page.tsx`

Agregar 3 queries paralelas (no bloquean entre sí):

```typescript
// Ejecutar en paralelo con Promise.all
const [trendingRes, topRatedRes, newRes] = await Promise.all([
  // 🔥 Trending (más calls en últimos 7 días)
  supabase.rpc('get_trending_agents', { days: 7, limit_count: 6 }),

  // ⭐ Top Rated (mejor reputation)
  supabase
    .from('agents')
    .select('*')
    .eq('status', 'active')
    .order('reputation_score', { ascending: false, nullsFirst: false })
    .limit(6),

  // 🆕 Just Launched (últimos 14 días)
  supabase
    .from('agents')
    .select('*')
    .eq('status', 'active')
    .gte('created_at', fourteenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(6),
]);
```

**Función RPC para trending (migración SQL):**
```sql
CREATE OR REPLACE FUNCTION get_trending_agents(days integer DEFAULT 7, limit_count integer DEFAULT 6)
RETURNS SETOF agents
LANGUAGE sql
STABLE
AS $$
  SELECT a.*
  FROM agents a
  INNER JOIN (
    SELECT agent_id, COUNT(*) as recent_calls
    FROM agent_calls
    WHERE called_at >= now() - (days || ' days')::interval
      AND status = 'success'
    GROUP BY agent_id
    ORDER BY recent_calls DESC
    LIMIT limit_count
  ) trending ON trending.agent_id = a.id
  WHERE a.status = 'active'
  ORDER BY trending.recent_calls DESC;
$$;
```

**C) Creator badges en ModelCard:**

```typescript
{/* Badge del creator */}
{model.creator_verified && (
  <span className="text-xs text-blue-600" title={t('marketplace.verifiedCreator')}>✓</span>
)}
{model.total_calls >= 1000 && (
  <span className="text-xs" title={t('marketplace.topAgent')}>🏆</span>
)}
```

**D) i18n keys:**
```json
{
  "home": {
    "trending": "Trending This Week",
    "topRated": "Top Rated",
    "justLaunched": "Just Launched",
    "trendingEs": "Tendencia Esta Semana",
    "topRatedEs": "Mejor Valorados",
    "justLaunchedEs": "Recién Lanzados"
  },
  "marketplace": {
    "calls": "calls",
    "callsEs": "llamadas",
    "verifiedCreator": "Verified Creator",
    "topAgent": "Top Agent"
  }
}
```

---

## MEJORA 3 — Curated Collections

**Clasificación NexusAgile:** QUALITY (nueva tabla + página + i18n)
**Archivos:** 5-6 archivos + 1 migración SQL

### Contexto actual

- No existe concepto de collections en BD ni UI
- Marketplace tiene filtro por categoría (NLP, Vision, Audio, Code, etc.)
- Landing page muestra grid plano sin curación

### Solución

**A) Migración SQL:**

```sql
-- 037_collections.sql
CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_key text NOT NULL,        -- i18n key: 'collections.defi'
  slug text UNIQUE NOT NULL,
  description_key text NOT NULL,  -- i18n key: 'collections.defiDesc'
  cover_emoji text DEFAULT '📦',  -- emoji como cover (simple, sin CDN de imágenes)
  agent_ids uuid[] DEFAULT '{}',  -- ordered list
  is_featured boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collections_public_read" ON collections FOR SELECT USING (true);
CREATE POLICY "collections_admin_write" ON collections FOR ALL
  USING (auth.uid() IN (
    SELECT id FROM creator_profiles WHERE verified = true
  ));

-- Seed data
INSERT INTO collections (name_key, slug, description_key, cover_emoji, is_featured, sort_order) VALUES
  ('collections.defi', 'best-for-defi', 'collections.defiDesc', '🔗', true, 1),
  ('collections.security', 'best-for-security', 'collections.securityDesc', '🛡️', true, 2),
  ('collections.developers', 'best-for-developers', 'collections.developersDesc', '💻', true, 3),
  ('collections.data', 'best-for-data', 'collections.dataDesc', '📊', true, 4),
  ('collections.content', 'best-for-content', 'collections.contentDesc', '📝', false, 5),
  ('collections.free', 'free-agents', 'collections.freeDesc', '🆓', true, 6);
```

**B) Página de colección:**

Archivo: `src/app/[locale]/collections/[slug]/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server';
import { getTranslations } from 'next-intl/server';

export const revalidate = 300; // ISR 5 min

export default async function CollectionPage({
  params: { locale, slug },
}: {
  params: { locale: string; slug: string };
}) {
  const t = await getTranslations();
  const supabase = await createClient();

  // Fetch collection
  const { data: collection } = await supabase
    .from('collections')
    .select('*')
    .eq('slug', slug)
    .single();

  if (!collection) notFound();

  // Fetch agents in collection (ordered)
  const { data: agents } = await supabase
    .from('agents')
    .select('*')
    .in('id', collection.agent_ids)
    .eq('status', 'active');

  // Re-order to match collection.agent_ids order
  const orderedAgents = collection.agent_ids
    .map((id: string) => agents?.find((a) => a.id === id))
    .filter(Boolean);

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <span className="text-4xl">{collection.cover_emoji}</span>
        <h1 className="text-3xl font-bold mt-2">{t(collection.name_key)}</h1>
        <p className="text-muted-foreground mt-1">{t(collection.description_key)}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {orderedAgents.map((agent, i) => (
          <ModelCard key={agent.id} model={agent} locale={locale} index={i} />
        ))}
      </div>
    </main>
  );
}
```

**C) Índice de collections:**

Archivo: `src/app/[locale]/collections/page.tsx`

```typescript
export const revalidate = 300;

export default async function CollectionsIndex({ params: { locale } }) {
  const t = await getTranslations();
  const supabase = await createClient();

  const { data: collections } = await supabase
    .from('collections')
    .select('*')
    .order('sort_order', { ascending: true });

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">{t('collections.title')}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {collections?.map((col) => (
          <Link key={col.id} href={`/${locale}/collections/${col.slug}`}
            className="group rounded-xl border p-6 hover:border-primary transition">
            <span className="text-3xl">{col.cover_emoji}</span>
            <h2 className="text-lg font-semibold mt-2 group-hover:text-primary">
              {t(col.name_key)}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t(col.description_key)}
            </p>
            <span className="text-xs text-muted-foreground mt-2 block">
              {col.agent_ids.length} {t('common.agents')}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

**D) Landing page — featured collections carousel:**

En `page.tsx`, después de la sección de agentes:

```typescript
const { data: featuredCollections } = await supabase
  .from('collections')
  .select('*')
  .eq('is_featured', true)
  .order('sort_order')
  .limit(4);

// Render como cards horizontales con link a /collections/[slug]
```

**E) Navbar — Link a collections:**

Agregar "Collections" al `WasiNavBar.tsx` después de "Docs".

**F) i18n keys (en + es):**

```json
{
  "collections": {
    "title": "Collections",
    "defi": "Best for DeFi",
    "defiDesc": "Top-rated agents for DeFi analysis, price feeds, and on-chain data",
    "security": "Best for Security",
    "securityDesc": "Smart contract auditing, risk analysis, and vulnerability detection",
    "developers": "Best for Developers",
    "developersDesc": "Code generation, debugging, and developer productivity tools",
    "data": "Best for Data",
    "dataDesc": "On-chain analytics, metrics, and data visualization agents",
    "content": "Best for Content",
    "contentDesc": "Marketing, copywriting, and social media automation",
    "free": "Free Agents",
    "freeDesc": "Try these agents at no cost — free trials available"
  }
}
```

---

## MEJORA 4 — Agent-to-Agent Discovery + Métricas

**Clasificación NexusAgile:** QUALITY (nuevo endpoint + SDK + métricas)
**Archivos:** 4-5 archivos + SDK update

### Contexto actual

- Agent-to-agent ya funciona técnicamente (agente A invoca agente B vía API key)
- `agent_calls.caller_type` diferencia `'agent'` vs `'human'`
- Falta endpoint de **discovery** para que agentes encuentren otros agentes
- Falta métrica pública de A2A volume
- SDK ya existe en `@wasiai/sdk` con `invoke()` pero no tiene `discover()`

### Solución

**A) Endpoint de discovery:**

Archivo: `src/app/api/v1/agents/discover/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const discoverSchema = z.object({
  category: z.string().optional(),
  max_price: z.coerce.number().positive().optional(),
  capability: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = discoverSchema.safeParse(Object.fromEntries(searchParams));

  if (!params.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: params.error.flatten() }, { status: 400 });
  }

  const { category, max_price, capability, limit } = params.data;
  const supabase = await createClient();

  let query = supabase
    .from('agents')
    .select('slug, name, description, price_per_call, category, capabilities, total_calls, reputation_score, free_trial_enabled, free_trial_limit')
    .eq('status', 'active')
    .order('total_calls', { ascending: false })
    .limit(limit);

  if (category) query = query.eq('category', category);
  if (max_price) query = query.lte('price_per_call', max_price);

  const { data: agents, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 });
  }

  // Filtro client-side por capability (capabilities es JSONB)
  let filtered = agents;
  if (capability && agents) {
    filtered = agents.filter((a) =>
      a.capabilities?.some((c: { name: string }) =>
        c.name.toLowerCase().includes(capability.toLowerCase())
      )
    );
  }

  return NextResponse.json({
    agents: filtered,
    total: filtered?.length || 0,
    meta: {
      invoke_endpoint: '/api/v1/models/{slug}/invoke',
      auth_methods: ['x-agent-key', 'x402'],
      docs_url: 'https://wasiai-v2.vercel.app/docs',
      sdk: 'npm install @wasiai/sdk',
    },
  });
}
```

**B) Transparency page — A2A metrics:**

Archivo: `src/app/[locale]/transparency/page.tsx`

Agregar query de A2A stats:

```typescript
// Agent-to-Agent volume
const { data: a2aStats } = await supabase
  .from('agent_calls')
  .select('caller_type')
  .eq('status', 'success');

const a2aCalls = a2aStats?.filter((c) => c.caller_type === 'agent').length || 0;
const humanCalls = a2aStats?.filter((c) => c.caller_type === 'human').length || 0;

// Más eficiente con RPC:
// CREATE FUNCTION get_a2a_stats() RETURNS jsonb ...
```

Renderizar en nueva card:
```typescript
<div className="rounded-xl border p-6">
  <h3 className="font-semibold">{t('transparency.agentEconomy')}</h3>
  <div className="grid grid-cols-2 gap-4 mt-4">
    <div>
      <p className="text-2xl font-bold">🤖 {a2aCalls.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{t('transparency.a2aCalls')}</p>
    </div>
    <div>
      <p className="text-2xl font-bold">👤 {humanCalls.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{t('transparency.humanCalls')}</p>
    </div>
  </div>
</div>
```

**C) Landing page — narrative section:**

Después de las stats existentes, agregar sección "Agent Economy":

```typescript
<section className="py-12 text-center">
  <h2 className="text-2xl font-bold">{t('home.agentEconomy')}</h2>
  <p className="text-muted-foreground mt-2">{t('home.agentEconomyDesc')}</p>
  <div className="flex justify-center gap-8 mt-6">
    <div>
      <p className="text-3xl font-bold">{a2aCalls}</p>
      <p className="text-sm text-muted-foreground">{t('home.a2aCalls')}</p>
    </div>
    <div>
      <p className="text-3xl font-bold">${a2aVolume}</p>
      <p className="text-sm text-muted-foreground">{t('home.a2aVolume')}</p>
    </div>
  </div>
</section>
```

**D) i18n keys:**
```json
{
  "home": {
    "agentEconomy": "The Agent Economy",
    "agentEconomyDesc": "Agents hiring agents. Agents paying agents. The first trustless agent economy on Avalanche.",
    "a2aCalls": "Agent-to-Agent Calls",
    "a2aVolume": "A2A Volume (USDC)"
  },
  "transparency": {
    "agentEconomy": "Agent Economy",
    "a2aCalls": "Agent-to-Agent",
    "humanCalls": "Human Calls"
  }
}
```

**E) SDK update (`@wasiai/sdk`):**

En el repo `wasiai-sdk`, agregar método `discover()`:

```typescript
// src/client.ts
async discover(options?: {
  category?: string;
  maxPrice?: number;
  capability?: string;
  limit?: number;
}): Promise<DiscoverResult> {
  const params = new URLSearchParams();
  if (options?.category) params.set('category', options.category);
  if (options?.maxPrice) params.set('max_price', String(options.maxPrice));
  if (options?.capability) params.set('capability', options.capability);
  if (options?.limit) params.set('limit', String(options.limit));

  const response = await this.fetch(`/api/v1/agents/discover?${params}`);
  return response.json();
}
```

CLI: `wasiai discover --category defi --max-price 0.05`

---

## MEJORA 5 — Creator CLI (`wasiai publish`)

**Clasificación NexusAgile:** QUALITY (SDK external repo)
**Archivos:** Repo `wasiai-sdk`, 2-3 archivos

### Contexto actual

- SDK tiene `wasiai invoke` CLI command
- API tiene `POST /api/v1/agents/register` con 3 auth methods
- No existe `wasiai publish` ni `wasiai stats`

### Solución

**A) CLI command `wasiai publish`:**

Archivo: `wasiai-sdk/src/cli/commands/publish.ts`

```typescript
import { Command } from 'commander';

export const publishCommand = new Command('publish')
  .description('Publish an agent to WasiAI marketplace')
  .requiredOption('-n, --name <name>', 'Agent name')
  .requiredOption('-d, --description <desc>', 'Agent description')
  .requiredOption('-c, --category <cat>', 'Category (nlp, vision, audio, code, multimodal, data)')
  .requiredOption('-p, --price <price>', 'Price per call in USDC', parseFloat)
  .requiredOption('-e, --endpoint <url>', 'Agent API endpoint URL')
  .option('-k, --api-key <key>', 'WasiAI API key (or WASIAI_API_KEY env)')
  .option('--capabilities <json>', 'Capabilities JSON array')
  .option('--rpm <rpm>', 'Rate limit: requests per minute', parseInt)
  .option('--rpd <rpd>', 'Rate limit: requests per day', parseInt)
  .action(async (opts) => {
    const apiKey = opts.apiKey || process.env.WASIAI_API_KEY;
    if (!apiKey) {
      console.error('❌ API key required. Set WASIAI_API_KEY or use --api-key');
      process.exit(1);
    }

    const body = {
      name: opts.name,
      slug: opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: opts.description,
      category: opts.category,
      price_per_call: opts.price,
      endpoint_url: opts.endpoint,
      capabilities: opts.capabilities ? JSON.parse(opts.capabilities) : [],
      rpm: opts.rpm || 60,
      rpd: opts.rpd || 1000,
    };

    const res = await fetch(`${baseUrl}/api/v1/agents/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`❌ ${data.error}`);
      process.exit(1);
    }

    console.log(`✅ Agent published: ${data.agent.slug}`);
    console.log(`🔗 ${baseUrl}/models/${data.agent.slug}`);
    if (data.managementKey) {
      console.log(`🔑 Management key: ${data.managementKey}`);
    }
  });
```

**B) CLI command `wasiai stats`:**

```typescript
export const statsCommand = new Command('stats')
  .description('View your agent statistics')
  .option('-k, --api-key <key>', 'WasiAI API key')
  .action(async (opts) => {
    // Fetch stats from /api/creator/analytics con auth
    // Display table with: agent, calls(24h), revenue, status
  });
```

**C) CLI command `wasiai discover`:**

```typescript
export const discoverCommand = new Command('discover')
  .description('Discover available agents')
  .option('-c, --category <cat>', 'Filter by category')
  .option('-p, --max-price <price>', 'Maximum price per call')
  .option('--capability <name>', 'Filter by capability name')
  .action(async (opts) => {
    // Fetch from /api/v1/agents/discover
    // Display table with: slug, price, calls, category
  });
```

---

## MEJORA 6 — Skills Marketplace

**Clasificación NexusAgile:** QUALITY (nueva tabla + publish flow + UI)
**Archivos:** 8-10 archivos + 1 migración SQL

### Contexto actual

- No existe concepto de "skills" en la BD
- Solo agentes completos con endpoint API
- Pinata IPFS ya configurado para file uploads (cover images)

### Solución

**A) Migración SQL:**

```sql
-- 038_skills_marketplace.sql
CREATE TABLE skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES creator_profiles(id) NOT NULL,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text NOT NULL,
  long_description text,
  category text NOT NULL,
  price_usdc numeric DEFAULT 0 CHECK (price_usdc >= 0),
  pricing_type text DEFAULT 'one-time' CHECK (pricing_type IN ('one-time', 'free')),
  content_url text,              -- SKILL.md file on Pinata IPFS
  preview_text text,             -- first 500 chars visible publicly
  compatible_with text[] DEFAULT '{}',  -- ['openclaw', 'langchain', 'claude-code', 'cursor']
  required_tools text[] DEFAULT '{}',
  tags text[] DEFAULT '{}',
  install_count integer DEFAULT 0,
  rating_avg numeric DEFAULT 0,
  rating_count integer DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE skill_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid REFERENCES skills(id) NOT NULL,
  buyer_id uuid REFERENCES auth.users(id) NOT NULL,
  amount_paid numeric NOT NULL DEFAULT 0,
  payment_method text DEFAULT 'free',
  purchased_at timestamptz DEFAULT now(),
  UNIQUE(skill_id, buyer_id)    -- 1 purchase per user per skill
);

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "skills_public_read" ON skills FOR SELECT USING (status = 'active');
CREATE POLICY "skills_creator_manage" ON skills FOR ALL USING (creator_id = auth.uid());
CREATE POLICY "purchases_user_read" ON skill_purchases FOR SELECT USING (buyer_id = auth.uid());
CREATE POLICY "purchases_user_insert" ON skill_purchases FOR INSERT WITH CHECK (buyer_id = auth.uid());

CREATE INDEX idx_skills_category ON skills(category) WHERE status = 'active';
CREATE INDEX idx_skills_creator ON skills(creator_id);
CREATE INDEX idx_skill_purchases_buyer ON skill_purchases(buyer_id);
```

**B) Marketplace tabs — Agents | Skills:**

Archivo: `src/app/[locale]/page.tsx`

Agregar tabs al marketplace. Tab "Agents" muestra el grid actual. Tab "Skills" muestra grid de skills:

```typescript
// URL: /?tab=skills
const tab = searchParams.tab || 'agents';

// Query skills si tab === 'skills'
if (tab === 'skills') {
  const { data: skills } = await supabase
    .from('skills')
    .select('*')
    .eq('status', 'active')
    .order('install_count', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
}
```

**C) SkillCard component:**

Archivo: `src/features/skills/components/SkillCard.tsx`

```typescript
interface SkillCardProps {
  skill: Skill;
  locale: string;
}

export function SkillCard({ skill, locale }: SkillCardProps) {
  return (
    <Link href={`/${locale}/skills/${skill.slug}`} className="group rounded-xl border p-4 hover:border-primary transition">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase">{skill.category}</span>
        {skill.price_usdc === 0 ? (
          <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Free</span>
        ) : (
          <span className="text-xs font-medium">${skill.price_usdc} USDC</span>
        )}
      </div>
      <h3 className="font-semibold mt-2 group-hover:text-primary">{skill.name}</h3>
      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{skill.description}</p>
      <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
        <span>📥 {skill.install_count} installs</span>
        {skill.compatible_with.slice(0, 3).map((c) => (
          <span key={c} className="bg-muted px-1.5 py-0.5 rounded">{c}</span>
        ))}
      </div>
    </Link>
  );
}
```

**D) Skill detail page:**

Archivo: `src/app/[locale]/skills/[slug]/page.tsx`

- Preview del contenido (primeras 500 chars)
- Botón "Install Free" o "Buy $X USDC"
- Compatible platforms listed
- Creator profile card
- Install count + rating

**E) Publish skill form:**

Reutilizar `PublishForm` con toggle inicial. Para skills:
- Step 1: Name, description, category, price
- Step 2: Upload SKILL.md file (Pinata), tags, compatibility
- Step 3: Preview + publish

**F) Creator dashboard — Skills section:**

Agregar tab "My Skills" al dashboard del creator con table de skills publicados.

**G) i18n:**
```json
{
  "skills": {
    "title": "Skills",
    "install": "Install",
    "installFree": "Install Free",
    "buy": "Buy for ${price} USDC",
    "installs": "{count} installs",
    "compatible": "Compatible with",
    "preview": "Preview",
    "publishSkill": "Publish a Skill"
  }
}
```

---

## MEJORA 7 — Bounties (Clawsourcing)

**Clasificación NexusAgile:** QUALITY (nueva tabla + UI + escrow integration)
**Archivos:** 6-8 archivos + 1 migración SQL

### Contexto actual

- `WasiEscrow.sol` ya soporta hold de USDC con release/refund
- No existe concepto de bounties en la BD

### Solución

**A) Migración SQL:**

```sql
-- 039_bounties.sql
CREATE TABLE bounties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES auth.users(id) NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  category text,
  reward_usdc numeric NOT NULL CHECK (reward_usdc >= 1),
  status text DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'completed', 'expired', 'cancelled')),
  deadline timestamptz,
  escrow_id text,                -- on-chain escrow reference
  winner_id uuid REFERENCES auth.users(id),
  winning_agent_id uuid REFERENCES agents(id),
  submissions_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE bounty_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid REFERENCES bounties(id) NOT NULL,
  submitter_id uuid REFERENCES auth.users(id) NOT NULL,
  agent_id uuid REFERENCES agents(id),
  skill_id uuid REFERENCES skills(id),
  message text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  submitted_at timestamptz DEFAULT now(),
  UNIQUE(bounty_id, submitter_id)  -- 1 submission per user per bounty
);

ALTER TABLE bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bounties_public_read" ON bounties FOR SELECT USING (true);
CREATE POLICY "bounties_creator_manage" ON bounties FOR ALL USING (creator_id = auth.uid());
CREATE POLICY "submissions_public_read" ON bounty_submissions FOR SELECT USING (true);
CREATE POLICY "submissions_user_manage" ON bounty_submissions FOR ALL USING (submitter_id = auth.uid());
```

**B) Bounties page:**

Archivo: `src/app/[locale]/bounties/page.tsx`

- Grid de bounties abiertas
- Card: título, reward en USDC, deadline, submissions count, categoría
- Filtros: categoría, reward range, status
- CTA: "Post a Bounty" → requiere auth + deposit USDC en escrow

**C) Bounty detail page:**

Archivo: `src/app/[locale]/bounties/[id]/page.tsx`

- Descripción completa
- Reward amount
- Deadline countdown
- Submissions list (agent/skill links + messages)
- Si es tu bounty: botón "Choose Winner" que libera escrow
- Si no es tu bounty: botón "Submit Agent/Skill"

**D) Flujo de escrow:**

1. Creator crea bounty → UI le pide firmar `transferWithAuthorization` (ERC-3009) para depositar reward en escrow
2. Backend llama `WasiEscrow.createEscrow(bountyId, amount)` on-chain
3. Submissions llegan
4. Creator elige ganador → backend llama `WasiEscrow.release()` → USDC va al winner
5. Si deadline pasa sin winner → creator puede llamar `refundExpired()` → USDC vuelve

**E) Navbar:**

Agregar "Bounties" después de "Collections" en `WasiNavBar.tsx`.

**F) i18n:**
```json
{
  "bounties": {
    "title": "Bounties",
    "postBounty": "Post a Bounty",
    "reward": "Reward",
    "deadline": "Deadline",
    "submissions": "{count} submissions",
    "submit": "Submit Your Agent",
    "chooseWinner": "Choose Winner",
    "open": "Open",
    "completed": "Completed",
    "expired": "Expired"
  }
}
```

---

## Patrones Transversales

### Patrón 1: i18n First
Toda string visible → key en `messages/en.json` + `messages/es.json`. NUNCA hardcodear texto en componentes.

### Patrón 2: ISR con revalidate
Páginas públicas nuevas (collections, bounties, skills) → `export const revalidate = 300` (5 min). Páginas de usuario (dashboard) → sin cache.

### Patrón 3: RLS by Default
Toda tabla nueva → RLS enabled + policies. Public read para marketplace, user-scoped para gestión.

### Patrón 4: Feature-first structure
```
src/features/skills/components/SkillCard.tsx
src/features/collections/components/CollectionCard.tsx
src/features/bounties/components/BountyCard.tsx
```

### Patrón 5: Zod en todo endpoint nuevo
Todo input → schema Zod antes de query. Pattern existente del proyecto.

---

*Guía técnica generada para el equipo de AI (OpenClaw + Claude Sonnet 4.6)*
*Stack target: Next.js 16 + React 19 + Supabase + Viem v2 + next-intl v4*
