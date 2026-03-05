# SDD #047: Dual Registration — Off-chain (free) + On-chain (ERC-8004) con Upgrade Path

> SPEC_APPROVED: yes (2026-03-05)
> Fecha: 2026-03-05
> Tipo: EPIC — feature
> SDD_MODE: full
> Branch: feat/047-dual-registration
> Artefactos: doc/sdd/047-dual-registration/

---

## 1. Resumen

Actualmente, publicar un agente en WasiAI siempre dispara `registerAgentOnChain()` (fire-and-forget) cuando el status cambia a `active` y el creator tiene wallet. Este EPIC introduce un modelo dual: registro off-chain gratuito como default para creators sin wallet, elección on-chain/off-chain para creators con wallet, y on-chain sugerido para agentes con AgentKit. Los agentes off-chain pueden escalar a on-chain en cualquier momento. El gas lo paga siempre el creator/upgrader.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 047 |
| **Linear** | WAS-160 |
| **Tipo** | EPIC — feature |
| **SDD_MODE** | full |
| **Objetivo** | Registro dual off-chain/on-chain con 3 paths según contexto de wallet y upgrade voluntario |
| **Reglas de negocio** | RN-1 a RN-4 (ver work-item.md) |
| **Scope IN** | Detección wallet, 3 paths registro, upgrade modal, badge, discovery boost, schema migration |
| **Scope OUT** | Migración masiva de agentes existentes, subsidio gas, reventa |

## 3. Acceptance Criteria (EARS)

### Registro según contexto de wallet
- **AC1**: WHEN un creator sin wallet conectada publica un agente, THE sistema SHALL registrarlo off-chain (solo Supabase) automáticamente, sin solicitar transacción blockchain.
- **AC2**: WHEN un creator con wallet conectada publica un agente, THE sistema SHALL presentar la opción de registrar on-chain (gas fee) u off-chain (gratis), permitiendo elegir.
- **AC3**: WHEN un agente con AgentKit wallet se registra vía API, THE sistema SHALL sugerir registro on-chain como default, con opción de elegir off-chain.
- **AC4**: WHILE un agente está registrado solo off-chain, THE sistema SHALL permitir funcionalidad completa: discovery, invocación, pagos, keys, edición.

### Upgrade a On-chain
- **AC5**: WHEN el owner de un agente off-chain solicita upgrade a on-chain, THE sistema SHALL presentar un flujo de upgrade con: beneficios, estimado de gas, y confirmación de wallet.
- **AC6**: WHEN el owner confirma el upgrade y firma la transacción, THE sistema SHALL mintear el token ERC-8004 y asociar `token_id` + `chain_registered_at` al registro existente sin crear un nuevo UUID.
- **AC7**: IF la transacción de upgrade falla o es revertida, THEN THE sistema SHALL mantener el agente en estado off-chain sin modificaciones, mostrando error descriptivo al usuario.

### Irreversibilidad y estado
- **AC8**: WHILE un agente está registrado on-chain, THE sistema SHALL mostrar badge "On-chain Verified" en la detail page, cards, y perfil del creator.
- **AC9**: IF un agente ya está registrado on-chain, THEN THE sistema SHALL ocultar la opción de upgrade (ya completado).

### Gas y costos
- **AC10**: WHEN el owner inicia registro o upgrade on-chain, THE sistema SHALL mostrar estimado de gas en AVAX antes de solicitar firma.
- **AC11**: WHILE la transacción está pendiente (registro directo o upgrade), THE sistema SHALL mostrar estado "Registering on-chain..." / "Upgrading..." con indicador de progreso.

### Discovery boost
- **AC12**: WHEN el algoritmo de discovery ordena agentes, THE sistema SHALL aplicar boost de ranking a agentes on-chain sobre off-chain (con igual score base).

---

## 4. Context Map (Codebase Grounding)

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/creator/agents/[slug]/status/route.ts` | Donde se dispara `registerAgentOnChain` actualmente (al status → active) | Fire-and-forget con `.catch()`, ownership check, CSRF, Zod validation |
| `src/app/api/v1/agents/register/route.ts` | API de auto-registro (agentes/developers). Ya llama `registerAgentOnChain` si hay `creator_wallet` | Auth multi-método (JWT/agent-key/open), Zod schema, management key |
| `src/lib/contracts/marketplaceClient.ts` | `registerAgentOnChain()` — llama `registerAgent(slug, price, wallet, erc8004Id)` en el contrato | Operator wallet server-side, viem, simulate + write pattern |
| `src/app/[locale]/publish/PublishForm.tsx` | Wizard de publicación 3 pasos. No detecta wallet del creator actualmente. Llama PATCH status→active | useState steps, ListingFeeModal gate, no wallet awareness |
| `src/app/api/v1/agents/discover/route.ts` | Discovery endpoint — ordena por `total_calls` desc. Sin boost on-chain | Supabase query builder, Zod params |
| `src/features/models/types/models.types.ts` | Tipo Agent — tiene `on_chain_registered: boolean` | Interfaz plana, boolean flag |
| `supabase/migrations/00000000000006_agents_marketplace.sql` | Columna `on_chain_registered BOOLEAN DEFAULT false` ya existe | Migration pattern: ALTER TABLE ADD COLUMN IF NOT EXISTS |

### Exemplars

| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| Upgrade modal UI | `src/app/[locale]/publish/ListingFeeModal.tsx` | Modal con estimado de costo + confirmación wallet |
| Upgrade API route | `src/app/api/creator/agents/[slug]/status/route.ts` | Ownership check + CSRF + Zod + contract call |
| Badge component | `src/features/models/components/ModelCard.tsx` | Ya muestra badges condicionales |
| Schema migration | `supabase/migrations/00000000000006_agents_marketplace.sql` | ALTER TABLE pattern |

### Estado de BD relevante

| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `agents` | Sí | `on_chain_registered` (boolean), `creator_id`, `slug`, `status` |
| `creator_profiles` | Sí | `wallet_address`, `id = auth.users.id` |
| `agents` (nuevas) | No | `registration_type` (enum), `token_id` (bigint nullable), `chain_registered_at` (timestamptz nullable) |

---

## 5. Diseño técnico

### 5.0 Contrato: `selfRegisterAgent()` (WAS-160g)

El `registerAgent()` actual es `onlyOperator`. Para que el creator firme y pague gas directamente, se agrega una nueva función:

```solidity
/**
 * @notice Self-registration: creator registers their own agent and pays gas.
 * @dev msg.sender becomes the creator. No operator needed.
 */
function selfRegisterAgent(
    string  calldata slug,
    uint256 pricePerCall,
    uint64  erc8004Id
) external whenNotPaused {
    require(bytes(slug).length > 0, "WasiAI: empty slug");
    require(
        agents[slug].creator == address(0),
        "WasiAI: slug taken"
    );

    agents[slug] = Agent({
        creator:       msg.sender,
        pricePerCall:  pricePerCall,
        erc8004Id:     erc8004Id,
        active:        true
    });

    emit AgentRegistered(slug, msg.sender, pricePerCall, erc8004Id);
}
```

**Diferencias con `registerAgent()`**:
- Sin `onlyOperator` — cualquier address puede llamarla
- `creator = msg.sender` (no parameter) — el firmante ES el creator, no se puede registrar a nombre de otro
- `whenNotPaused` — respeta el pause del contrato (seguridad)
- Mismo evento `AgentRegistered` — compatibilidad con indexers existentes

**`registerAgent()` se mantiene intacta** — el operator sigue usándola para AgentKit y flows server-side.

**Tests requeridos** (Foundry):
- `test_selfRegisterAgent_success` — creator registra, verifica Agent struct
- `test_selfRegisterAgent_duplicateSlug_reverts` — slug ya tomado
- `test_selfRegisterAgent_emptySlug_reverts`
- `test_selfRegisterAgent_whenPaused_reverts`
- `test_selfRegisterAgent_emitsEvent` — verifica AgentRegistered event

### 5.1 Schema Migration (WAS-160a)

```sql
-- Crear enum para tipo de registro
CREATE TYPE registration_type AS ENUM ('off_chain', 'on_chain');

-- Nuevas columnas en agents
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS registration_type registration_type DEFAULT 'off_chain',
  ADD COLUMN IF NOT EXISTS token_id BIGINT,
  ADD COLUMN IF NOT EXISTS chain_registered_at TIMESTAMPTZ;

-- Retrocompat: agentes existentes con on_chain_registered=true → on_chain
UPDATE agents
  SET registration_type = 'on_chain',
      chain_registered_at = updated_at
  WHERE on_chain_registered = true;

-- Índice para discovery boost
CREATE INDEX IF NOT EXISTS idx_agents_registration_type ON agents(registration_type);
```

> `on_chain_registered` boolean se mantiene por retrocompat pero `registration_type` es la fuente de verdad going forward.

### 5.2 Refactor Publish Flow — 3 paths (WAS-160b)

**Flujo actual** (status/route.ts):
```
status → active → if wallet → registerAgentOnChain() fire-and-forget
```

**Flujo nuevo**:

```
PublishForm.handlePublish()
  │
  ├─ Detectar wallet: useAccount() de wagmi
  │
  ├─ Sin wallet:
  │    PATCH status → active (registration_type: 'off_chain')
  │    NO llama registerAgentOnChain()
  │
  ├─ Con wallet (humano):
  │    Mostrar RegistrationChoiceModal:
  │      "Register on-chain (gas fee ~X AVAX)" / "Register free (off-chain)"
  │    Si elige on-chain:
  │      → Client-side: usuario firma tx selfRegisterAgent() con su wallet (paga gas)
  │      → Backend: PATCH status → active + registration_type: 'on_chain', token_id, chain_registered_at
  │    Si elige off-chain:
  │      → PATCH status → active (registration_type: 'off_chain')
  │
  └─ API register (AgentKit):
       Body incluye `register_on_chain: true|false` (default true si creator_wallet presente)
       Si true → operator llama registerAgentOnChain() server-side (como hoy)
       Si false → solo DB
```

**Cambio crítico**: El registro on-chain para humanos pasa de **server-side operator** a **client-side user wallet**. El usuario llama `selfRegisterAgent()` (nueva función del contrato) y paga el gas. Para la API (AgentKit), el operator sigue usando `registerAgent()` (onlyOperator) server-side.

**Decisión de diseño**: ¿Quién firma y qué función?

| Escenario | Función del contrato | Firmante | Gas lo paga |
|-----------|---------------------|----------|-------------|
| Humano con wallet (publish) | `selfRegisterAgent()` | **Creator client-side** (wagmi `useWriteContract`) | Creator |
| Humano upgrade (ya publicado) | `selfRegisterAgent()` | **Creator client-side** | Creator |
| AgentKit via API | `registerAgent()` (onlyOperator) | **Operator server-side** | Operator (recuperable como fee) |

> Para AgentKit: el operator firma porque el agente registra vía API sin browser. `registerAgent()` se mantiene intacta para este flujo.

### 5.3 Upgrade Modal + Mint (WAS-160c)

**Nuevo componente**: `UpgradeOnChainModal`

Ubicación: `src/features/agents/components/UpgradeOnChainModal.tsx`

**Flujo**:
1. Creator ve botón "Upgrade to On-chain" en su agent detail/dashboard
2. Click → Modal con:
   - Lista de beneficios (ownership, composabilidad, reputación, censura, badge)
   - Estimado de gas (via `estimateContractGas` de viem)
   - Balance AVAX del creator
   - Botón "Confirm & Sign"
3. Creator firma con wallet (wagmi `useWriteContract` → `selfRegisterAgent`)
4. UI muestra "Upgrading..." con polling de receipt
5. Al confirmar:
   - Frontend llama `POST /api/creator/agents/[slug]/upgrade-onchain` con `txHash`
   - Backend verifica receipt on-chain (HAL-025 pattern), actualiza DB:
     ```sql
     UPDATE agents SET
       registration_type = 'on_chain',
       on_chain_registered = true,
       token_id = <from_event>,
       chain_registered_at = NOW()
     WHERE slug = $1 AND creator_id = $2
     ```
6. Si tx falla → toast de error, agente queda off-chain sin cambios

**API Route**: `POST /api/creator/agents/[slug]/upgrade-onchain`

```typescript
// Zod schema
const upgradeSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
})
```

- Auth: JWT (creator only)
- CSRF: sí
- Ownership check: `creator_id === user.id`
- Verifica receipt on-chain antes de update DB (patrón HAL-025 de WAS-141)
- Extrae `token_id` del event log si el contrato lo emite

### 5.4 Badge "On-chain Verified" (WAS-160d)

**Componente**: `OnChainBadge` — small badge reutilizable

```tsx
// src/components/badges/OnChainBadge.tsx
export function OnChainBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      <ShieldCheck className="h-3 w-3" /> On-chain
    </span>
  )
}
```

Mostrar en:
- `ModelCard.tsx` — junto al nombre
- `AgentDetailPage` — junto al título
- `CreatorProfile` — en la lista de agentes del creator

Condición: `agent.registration_type === 'on_chain'`

### 5.5 Discovery Boost (WAS-160e)

En `src/app/api/v1/agents/discover/route.ts`, agregar ordering:

Usar RPC function con `CASE WHEN` para ordering robusto (no depender de orden alfabético del enum):

```sql
-- En la migration
CREATE OR REPLACE FUNCTION discover_agents_v2(
  p_category TEXT DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS SETOF agents AS $$
  SELECT * FROM agents
  WHERE status = 'active'
    AND (p_category IS NULL OR category = p_category)
    AND (p_max_price IS NULL OR price_per_call <= p_max_price)
  ORDER BY
    CASE WHEN registration_type = 'on_chain' THEN 1 ELSE 0 END DESC,
    total_calls DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;
```

En el route handler, llamar via `.rpc('discover_agents_v2', { p_category, p_max_price, p_limit })`.

### 5.6 Retrocompat (WAS-160f)

La migration de 5.1 ya cubre esto:
```sql
UPDATE agents SET registration_type = 'on_chain', chain_registered_at = updated_at
WHERE on_chain_registered = true;
```

Todos los agentes existentes (que ya fueron registrados on-chain) quedan marcados como `on_chain`. Nuevos agentes empiezan como `off_chain` por default.

### 5.7 API Register — AgentKit path (cambios en WAS-160b)

En `src/app/api/v1/agents/register/route.ts`:

```typescript
// Nuevo campo opcional en schema
register_on_chain: z.boolean().optional(), // default: true si creator_wallet presente, false si no

// En la lógica del handler:
const registerOnChain = data.register_on_chain ?? !!data.creator_wallet

// En la inserción:
registration_type: registerOnChain ? 'on_chain' : 'off_chain',

// Solo llamar registerAgentOnChain si on-chain + tiene wallet:
if (registerOnChain && data.creator_wallet) {
  registerAgentOnChain({ ... }).catch(...)
}
```

### 5.8 Tipos TypeScript

```typescript
// src/features/models/types/models.types.ts
export type RegistrationType = 'off_chain' | 'on_chain'

// Agregar a la interfaz Agent:
registration_type: RegistrationType
token_id: number | null
chain_registered_at: string | null
```

---

## 6. Estimación de gas (UX)

Para AC10, el modal usa `estimateContractGas` de viem:

```typescript
const gasEstimate = await publicClient.estimateContractGas({
  address: MARKETPLACE_CONTRACT,
  abi: WASIAI_MARKETPLACE_ABI,
  functionName: 'selfRegisterAgent',
  args: [slug, priceAtomics, 0n],  // sin creator param — msg.sender es el creator
  account: creatorAddress,
})

const gasPrice = await publicClient.getGasPrice()
const costWei = gasEstimate * gasPrice
// Mostrar en AVAX: formatEther(costWei)
```

---

## 7. i18n Keys

Nuevas keys en `messages/en.json` y `messages/es.json`:

```json
{
  "publish": {
    "registrationChoice": {
      "title": "Choose registration type",
      "onChainOption": "Register on-chain",
      "onChainDesc": "Verifiable ownership via ERC-8004 token. Gas fee applies.",
      "offChainOption": "Register free",
      "offChainDesc": "Full functionality. Upgrade to on-chain anytime.",
      "gasEstimate": "Estimated gas: {amount} AVAX"
    }
  },
  "agent": {
    "upgrade": {
      "button": "Upgrade to On-chain",
      "title": "Upgrade to On-chain Registration",
      "benefits": {
        "ownership": "Verifiable cryptographic ownership",
        "composability": "Cross-protocol composability (DeFi, DAOs)",
        "reputation": "Immutable reputation history",
        "censorship": "Censorship resistance",
        "badge": "On-chain Verified badge + discovery boost"
      },
      "gasEstimate": "Estimated gas: {amount} AVAX",
      "balance": "Your balance: {amount} AVAX",
      "confirm": "Confirm & Sign",
      "upgrading": "Upgrading...",
      "success": "Agent upgraded to on-chain!",
      "error": "Upgrade failed: {message}"
    },
    "badge": {
      "onChain": "On-chain"
    }
  }
}
```

---

## 8. Constraint Directives (Anti-Alucinación)

### OBLIGATORIO
- Patrón de API route: seguir `status/route.ts` (Zod + CSRF + ownership + createClient)
- Patrón de modal: seguir `ListingFeeModal.tsx` (wallet interaction + gas)
- Patrón de receipt verification: seguir HAL-025 de WAS-141 (verify on-chain before DB update)
- Imports: solo módulos que EXISTEN en el proyecto
- Registro on-chain humano: **client-side** con wagmi `useWriteContract` — NO operator server-side
- Migration: formato `0XX_descripcion.sql`

### PROHIBIDO
- NO agregar dependencias nuevas (viem, wagmi, next-intl ya están en el proyecto)
- NO usar ethers.js
- NO modificar `registerAgent()` existente — agregar `selfRegisterAgent()` como función nueva
- NO agregar modifiers custom al contrato — usar `whenNotPaused` existente
- NO eliminar la columna `on_chain_registered` (mantener retrocompat)
- NO subsidiar gas — siempre lo paga el creator/upgrader
- NO hardcodear direcciones de contrato
- NO hacer upgrade reversible

---

## 9. Sub-HUs — Orden de ejecución

| Sub-HU | Descripción | Dependencia | Tamaño | ACs |
|--------|-------------|-------------|--------|-----|
| WAS-160g | Contrato: `selfRegisterAgent()` + tests Foundry | — | S | (infra — habilita AC2, AC5, AC6, AC10) |
| WAS-160a | Schema migration: `registration_type` enum + columnas + retrocompat agentes existentes | — | S | (infra) |
| WAS-160b | Publish flow: 3 paths según wallet + API register refactor | 160a, 160g, WAS-158 | M | AC1, AC2, AC3, AC4 |
| WAS-160c | Upgrade modal + API + mint via `selfRegisterAgent` | 160a, 160g | L | AC5, AC6, AC7, AC10, AC11 |
| WAS-160d | Badge "On-chain Verified" | 160a | S | AC8, AC9 |
| WAS-160e | Discovery boost on-chain (RPC function) | 160a | S | AC12 |

> WAS-160f fusionada con WAS-160a (la retrocompat es un UPDATE en la misma migration).

### Orden propuesto
1. **Paralelo**: WAS-160g (contrato) + WAS-160a (schema) — sin dependencia entre sí
2. **Paralelo**: WAS-160b + WAS-160c + WAS-160d + WAS-160e (dominios independientes, dependen de 160a; 160b y 160c además dependen de 160g)
   - ⚠️ WAS-160b bloqueada por WAS-158 (Pinata → Supabase) si la metadata URI cambia

---

*SDD generado por NexusAgil — F2*
*SPEC_APPROVED: 2026-03-05 — Story Files generados en F2.5*
