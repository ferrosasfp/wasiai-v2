# Sprint 15 Planning — WasiAI

**Fecha:** 2026-03-02  
**Scrum Master + Architect:** San (NexusAgil)  
**Estado:** DRAFT — pendiente aprobación de Fer  
**Sprint anterior:** 14 — DONE ✅  
**Próxima migración disponible:** `032_xxx.sql`

---

## Goal del Sprint 15

> **"Builders con superpoderes: agentes autónomos con wallet, sandbox gratuito para explorar sin USDC real, pipelines asíncronos y deuda técnica de Webhooks eliminada."**

---

## Codebase Grounding — Estado actual relevante

| Área | Estado real |
|------|------------|
| `jobs` table | ✅ Existe (`028_async_jobs.sql`) — id, user_id, agent_slug, status, input, result, error, timestamps |
| `GET /api/v1/jobs/[id]` | ✅ Existe — polling con RLS, retorna jobId/status/result |
| `POST /api/v1/jobs` | ❌ No existe — falta endpoint para crear un job async |
| `/api/v1/compose` | ✅ Existe — pipeline síncrono HU-5.1 + paralelo HU-5.2, hasta 5 steps |
| `agentkit_wallet` column | ✅ Columna en `agents` (migration `00000000000005`) — solo almacena address, vacío para todos |
| `WebhooksPanel.tsx` | ✅ 314 líneas — funcional, con 6 bugs menores documentados en AR Sprint 14 |
| `validateEndpointUrl` | ✅ `src/lib/security/validateEndpointUrl.ts` — ya protege invoke/route.ts |
| Sandbox / builder credits | ❌ No existe — ninguna tabla, ruta ni UI |
| UI de pipelines | ❌ No existe — ningún componente frontend para visualizar/construir pipelines |
| `free_trial_enabled` | ✅ En `agents` table — controla trials gratuitos por agente |

---

## HUs seleccionadas para Sprint 15

### Resumen

| ID | HU | Prioridad | SP | Modo |
|----|----|-----------|----|------|
| WAS-71 | Agentes con wallet propia (self-custody) | P1 | 13 | QUALITY |
| WAS-75 | Sandbox gratuito para builders (Fuji + créditos) | P1 | 8 | QUALITY |
| WAS-70 | Ejecución asíncrona de pipelines (jobs async) | P2 | 5 | QUALITY |
| WAS-38 | UI visual de pipelines de agentes | P2 | 8 | QUALITY |
| Deuda-WAS-74 | 6 menores críticos Webhooks UI | fix | 3 | FAST |

**Total SP propuestos: 37**  
**Capacidad recomendada sprint: 34 SP** (buffer 10%)

---

---

## WAS-71 — HU-6.5: Agentes con wallet propia (self-custody payments)

### Descripción técnica real

**Qué existe hoy:**
- Columna `agentkit_wallet TEXT` en tabla `agents` (migration `00000000000005_erc8004_agentkit.sql`) — solo guarda una address, vacía para todos los agentes actuales.
- `src/actions/wallet.ts` — linkea wallet de creator a su perfil de usuario. Flujo human-controlled, no autónomo.
- Invoke route (`/api/v1/models/[slug]/invoke/route.ts`) — pago x402 llega del consumer a `CONTRACT_ADDRESS`, el contrato liquida 90% al `creator_wallet` del creator. Los agentes NO tienen wallet propia ni pueden pagar a otros agentes directamente.
- No existe: generación de keypair por agente, almacenamiento cifrado de private key, financiamiento automático, ni flujo de pago agente→agente con wallet self-custody.

**Qué hay que construir:**

1. **Migration `032_agent_wallets.sql`** — Nueva tabla `agent_wallets`:
   ```sql
   CREATE TABLE agent_wallets (
     agent_slug TEXT PRIMARY KEY REFERENCES agents(slug) ON DELETE CASCADE,
     address    TEXT NOT NULL CHECK (address ~ '^0x[a-fA-F0-9]{40}$'),
     encrypted_private_key TEXT NOT NULL, -- AES-256-GCM con AGENT_WALLET_ENCRYPTION_KEY env var
     created_at TIMESTAMPTZ DEFAULT now()
   );
   ALTER TABLE agent_wallets ENABLE ROW LEVEL SECURITY;
   -- Solo service role accede (no RLS para usuarios normales)
   CREATE POLICY "service_only" ON agent_wallets USING (false);
   ```

2. **`src/lib/agent-wallets/agentWallet.ts`** — Funciones:
   - `generateAgentWallet(slug)` → genera keypair con viem `generatePrivateKey()`, cifra con AES-256-GCM, guarda en DB.
   - `getAgentWalletAddress(slug)` → retorna solo address (no private key) para uso público.
   - `getAgentWalletClient(slug)` → descifra private key en memoria, retorna viem WalletClient para firmar txs.

3. **`POST /api/v1/agents/[slug]/wallet`** — Endpoint para que el creator inicialice la wallet de su agente. Requiere auth + ownership check. Idempotente (si ya existe, retorna la address).

4. **`GET /api/v1/agents/[slug]/wallet`** — Retorna solo `{ address, balance_usdc }`. Sin private key jamás.

5. **`src/app/[locale]/creator/dashboard/_components/AgentWalletSection.tsx`** — UI en dashboard para que el creator vea la wallet address, saldo USDC en Fuji, QR para fondear, y botón "Inicializar wallet".

6. **Integración en invoke/route.ts** — Si el agente tiene wallet (`agent_wallets` existe para ese slug), y el pipeline lo requiere (flag `use_agent_wallet: true` en la invocación), el agente paga el siguiente step con su propia wallet via x402 usando `getAgentWalletClient()`.

### Dependencias
- Ninguna bloqueante para inicializar wallet y mostrar en UI.
- Para uso en pipelines (pago autónomo): WAS-70 debe estar done o en paralelo.
- Var de entorno nueva: `AGENT_WALLET_ENCRYPTION_KEY` (AES-256 key, 32 bytes hex).

### Story Points
**13 SP** — Complejidad alta: criptografía, nueva tabla con RLS especial, UI, integración con invoke.

### Subtareas (máx. 1 día c/u)

| # | Subtarea | Estimado |
|---|----------|----------|
| T1 | Migration 032 + lib `agentWallet.ts` (generate, get, client) | 1 día |
| T2 | `POST /api/v1/agents/[slug]/wallet` + `GET /api/v1/agents/[slug]/wallet` | 0.5 día |
| T3 | `AgentWalletSection.tsx` — UI dashboard (address, balance, QR, init button) | 1 día |
| T4 | Integración invoke/route.ts — pago agente→agente cuando `use_agent_wallet: true` | 1 día |
| T5 | Tests vitest + AR | 0.5 día |

### Definition of Done
- [ ] `agent_wallets` table con RLS service-only activo en producción
- [ ] Creator puede inicializar wallet desde dashboard — address visible en UI
- [ ] `GET /api/v1/agents/[slug]/wallet` retorna address + balance USDC Fuji real (viem `getBalance`)
- [ ] Private key NUNCA aparece en logs, responses ni frontend — validado en AR
- [ ] Invoke con `use_agent_wallet: true` y saldo suficiente: pago x402 firmado con wallet del agente
- [ ] Invoke con `use_agent_wallet: true` y saldo cero: retorna 402 con `agent_wallet_insufficient_balance`
- [ ] `AGENT_WALLET_ENCRYPTION_KEY` en `.env.example`
- [ ] `forge test` 0 errores, `npm run build` 0 errores
- [ ] git push origin master master:main

### Modo NexusAgil
**QUALITY** — manejo de private keys, pagos reales posibles, producción.

### Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Private key leak en logs/response | Media | CRÍTICO | AR adversarial explícito antes de merge |
| Pérdida de fondos si encryption key rota | Alta | Alto | Backup de encryption key en secrets manager, no solo env var |
| Gas cost en Fuji es libre, pero en mainnet agentes necesitan AVAX | Media | Medio | Scope Sprint 15 = solo Fuji; mainnet en Sprint 16 con WAS-22 |
| invoke/route.ts ya es complejo (406 líneas) — integración puede romper el golden path | Alta | Alto | Subtarea T4 aislada con feature flag, fallback a comportamiento actual |

### Costo adicional
- `$0` para Fuji (testnet gratuito)
- Mainnet: requiere AVAX en wallets de agentes para gas — evaluado en Sprint 16
- Encryption: usar env var existente pattern, no infraestructura nueva

---

---

## WAS-75 — HU-9.1: Sandbox gratuito para builders (Opción A: Fuji + créditos automáticos)

> ⚠️ **Nota de naming:** `story-HU-9.1.md` existente en el repo es sobre "Empty state búsqueda sin resultados" (ya implementado en Sprint anterior). Esta HU-9.1 del Sprint 15 es una numeración nueva de backlog — se registra como WAS-75 para evitar colisión.

### Descripción técnica real

**Qué existe hoy:**
- El invoke route ya corre en Fuji (43113) por defecto. USDC Fuji address: `0x5425890298aed601595a70AB815c96711a31Bc65`.
- `free_trial_enabled` + `free_trial_limit` en `agents` table — permite 1 llamada gratis por usuario/agente, controlado por creator.
- No existe: concepto de "sandbox account", créditos automáticos, API key de developer sin USDC real, ni onboarding de builder sin wallet.

**Qué hay que construir:**

1. **Migration `033_sandbox_credits.sql`** — Nueva tabla `sandbox_credits`:
   ```sql
   CREATE TABLE sandbox_credits (
     user_id        UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
     balance_usdc   NUMERIC(18,6) NOT NULL DEFAULT 0.5, -- 0.5 USDC de crédito inicial
     total_granted  NUMERIC(18,6) NOT NULL DEFAULT 0.5,
     total_used     NUMERIC(18,6) NOT NULL DEFAULT 0,
     created_at     TIMESTAMPTZ DEFAULT now(),
     last_refill_at TIMESTAMPTZ DEFAULT now()
   );
   ALTER TABLE sandbox_credits ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "user_own_credits" ON sandbox_credits FOR ALL USING (auth.uid() = user_id);
   ```

2. **`src/lib/sandbox/sandboxCredits.ts`** — Funciones:
   - `initSandboxCredits(userId)` → upsert con 0.5 USDC de crédito si no existe.
   - `deductSandboxCredit(userId, amountUsdc)` → decrementa atómicamente con RPC Postgres, retorna `{ ok, remaining }`. Falla si `balance < amount`.
   - `getSandboxBalance(userId)` → retorna balance actual.

3. **`POST /api/v1/sandbox/invoke/[slug]`** — Endpoint alternativo al invoke normal:
   - No requiere header `X-PAYMENT` (no x402).
   - Valida que `sandbox_credits.balance >= agent.price_per_call`.
   - Llama al upstream del agente igual que invoke/route.ts.
   - Deduce crédito via `deductSandboxCredit()`.
   - Rate limit: 10 calls/hora por user (Redis, `rl:sandbox:{userId}`).
   - Log en `agent_calls` con `payment_type = 'sandbox'` (columna nueva en migration).

4. **`POST /api/v1/sandbox/init`** — Trigger inicial: crea registro en `sandbox_credits` con 0.5 USDC. Idempotente. Llamado automáticamente en onboarding o primera visita al sandbox.

5. **`src/app/[locale]/sandbox/page.tsx`** — Página `/sandbox`:
   - Muestra saldo de créditos sandbox.
   - Selector de agente del marketplace.
   - Input/output igual al playground actual.
   - Badge "Sandbox — Fuji Testnet" visible.
   - CTA: "¿Listo para producción? Deposita USDC → /deposit".

6. **Nav link** — Agregar "Sandbox" en navbar para developers.

### Dependencias
- Ninguna bloqueante. Es stack completamente nuevo paralelo al flujo de pago real.
- No depende de WAS-71 ni WAS-70.

### Story Points
**8 SP** — Scope acotado: nueva tabla simple, endpoint de invoke sin x402, UI básica.

### Subtareas

| # | Subtarea | Estimado |
|---|----------|----------|
| T1 | Migration 033 sandbox_credits + columna `payment_type` en agent_calls | 0.5 día |
| T2 | `sandboxCredits.ts` + `POST /api/v1/sandbox/init` | 0.5 día |
| T3 | `POST /api/v1/sandbox/invoke/[slug]` con rate limit y deducción atómica | 1 día |
| T4 | `src/app/[locale]/sandbox/page.tsx` + Nav link | 1 día |
| T5 | Tests + AR | 0.5 día |

### Definition of Done
- [ ] Usuario nuevo sin USDC puede llamar agentes en Fuji desde `/sandbox`
- [ ] Crédito inicial 0.5 USDC asignado automáticamente al primer acceso
- [ ] Deducción atómica — concurrent calls no pueden gastar más de lo disponible
- [ ] Rate limit 10 calls/hora activo (Redis)
- [ ] `agent_calls` registra `payment_type = 'sandbox'` — separado de llamadas reales
- [ ] Balance visible en tiempo real en `/sandbox`
- [ ] CTA hacia `/deposit` cuando créditos agotados
- [ ] `npm run build` 0 errores, i18n es/en para página sandbox
- [ ] git push origin master master:main

### Modo NexusAgil
**QUALITY** — afecta UX de adquisición de builders, créditos son real money equivalente aunque sea testnet.

### Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Abuse de créditos sandbox (bots) | Alta | Medio | Rate limit Redis + 1 init por email verificado |
| Deducción no atómica → balance negativo | Media | Medio | RPC Postgres con CHECK constraint `balance >= 0` |
| Sandbox confunde users con producción | Media | Bajo | Badge visual claro "Sandbox — Fuji Testnet", datos no son reales |

### Costo adicional
- `$0` — Fuji es gratuito. Los créditos son simulados (no hay USDC real moviéndose).
- Si se escala a muchos usuarios con refills automáticos: evaluar política de refills en Sprint 16.

---

---

## WAS-70 — HU-5.1b: Ejecución asíncrona de pipelines (jobs + polling)

### Descripción técnica real

**Qué existe hoy:**
- Tabla `jobs` completa (`028_async_jobs.sql`): id, user_id, agent_slug, status (pending/processing/completed/failed), input, result, error, timestamps.
- `GET /api/v1/jobs/[id]` — polling endpoint implementado y funcional con RLS.
- `POST /api/v1/compose` — ejecuta pipelines de forma **síncrona** (hasta 5 steps, timeout total limitado por Vercel 10s).

**Qué falta:**
- `POST /api/v1/jobs` — endpoint para crear un job async (no existe).
- Worker de ejecución background — en Vercel no hay background threads. Opciones:
  - **Opción A (recomendada):** `POST /api/v1/jobs` crea job en DB con status `pending`, luego hace `fetch` a un endpoint interno `/api/v1/jobs/process/[id]` con `waitUntil` (Edge runtime) para ejecución en background.
  - **Opción B:** Cron cada 30s que procesa jobs `pending` (más simple, más latencia).
- Integración con `compose` para que un pipeline largo pueda ejecutarse como job async.

**Scope Sprint 15:** Opción A — job async single-agent. Pipeline async se entrega si el tiempo lo permite (stretch goal).

**Archivos a crear/modificar:**
- `src/app/api/v1/jobs/route.ts` — POST handler (crear job)
- `src/app/api/v1/jobs/process/[id]/route.ts` — Ejecuta job en background (llama invoke real)
- `src/app/api/v1/jobs/[id]/route.ts` — Ya existe (GET polling) — añadir webhook trigger al completar

### Dependencias
- Tabla `jobs` ya existe — no requiere migración nueva.
- Independiente de WAS-71 y WAS-75.
- WAS-38 (UI de pipelines) depende de este endpoint para mostrar estado.

### Story Points
**5 SP** — Infraestructura ya preparada, solo falta conectar las piezas.

### Subtareas

| # | Subtarea | Estimado |
|---|----------|----------|
| T1 | `POST /api/v1/jobs` — crear job, validar agent_slug existe, retornar jobId | 0.5 día |
| T2 | `POST /api/v1/jobs/process/[id]` — ejecutar invoke real, update status/result en DB | 1 día |
| T3 | Trigger webhook `job.completed` / `job.failed` al finalizar (integrar con triggerAgentEvent) | 0.5 día |
| T4 | Tests + AR | 0.5 día |

### Definition of Done
- [ ] `POST /api/v1/jobs` retorna `{ jobId, status: 'pending' }` inmediatamente (< 200ms)
- [ ] Job se procesa en background y actualiza status a `completed` o `failed`
- [ ] `GET /api/v1/jobs/:id` retorna status/result actualizado en polling
- [ ] Webhook `job.completed` disparado si creator tiene webhook configurado
- [ ] Job con agente inexistente: `404` inmediato, no crea job
- [ ] Job processing con error del upstream: status `failed`, error guardado
- [ ] Tests vitest para POST y el process handler
- [ ] git push origin master master:main

### Modo NexusAgil
**QUALITY** — afecta flujo de pagos (invoke real en background).

### Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Vercel cold start mata el background request antes de completar | Media | Alto | Usar `waitUntil` en Edge runtime; documentar límite de 30s |
| Job stuck en `processing` si proceso muere | Media | Medio | Timeout job: si `updated_at` > 5min y status=processing → marcar failed (cron cleanup) |
| Race condition doble-processing | Baja | Medio | UPDATE status='processing' WHERE status='pending' atómico antes de ejecutar |

### Costo adicional
- `$0` — usa tabla existente, Vercel Edge runtime incluido en plan.

---

---

## WAS-38 — HU-5.4: UI visual de pipelines de agentes

### Descripción técnica real

**Qué existe hoy:**
- `POST /api/v1/compose` — API de pipelines síncrona completa: steps, parallel, pass_output, receipts.
- `GET /api/v1/jobs/[id]` — polling de jobs async (cuando WAS-70 esté done).
- No existe ningún componente frontend para pipelines. El dashboard del creator solo tiene: AgentActions, EarningsSection, FreeTrialToggle, WebhooksPanel.

**Qué hay que construir:**
- `src/app/[locale]/pipelines/page.tsx` — Página `/pipelines` (nueva ruta, no dentro del creator dashboard).
- `src/app/[locale]/pipelines/_components/PipelineBuilder.tsx` — Constructor de pipeline:
  - Lista de steps (agregar/reordenar/eliminar).
  - Por step: selector de agente (dropdown con agentes del marketplace), input manual o "tomar output del step anterior" (pass_output).
  - Toggle "Paralelo" por step.
  - Botón "Ejecutar" → llama `POST /api/v1/compose` (síncrono) o `POST /api/v1/jobs` (async, si WAS-70 done).
- `src/app/[locale]/pipelines/_components/PipelineStatus.tsx` — Visualizador de estado:
  - Lista de steps con iconos: ⏳ pending → 🔄 running → ✅ done / ❌ failed.
  - Output de cada step visible al expandir.
  - Total cost USDC mostrado al finalizar.
- `src/app/[locale]/pipelines/_components/PipelineHistory.tsx` — Historial de ejecuciones (query a `pipeline_executions` table que ya existe en compose route).

### Dependencias
- `POST /api/v1/compose` ya existe — pipeline síncrono funciona sin WAS-70.
- WAS-70 es un **stretch goal**: si está done, añadir modo async. Si no, solo modo síncrono.
- Independiente de WAS-71 y WAS-75.

### Story Points
**8 SP** — UI compleja pero sin lógica de negocio nueva.

### Subtareas

| # | Subtarea | Estimado |
|---|----------|----------|
| T1 | `PipelineBuilder.tsx` — constructor de steps con selector de agente | 1 día |
| T2 | Integración con `POST /api/v1/compose` — ejecución y manejo de errores | 0.5 día |
| T3 | `PipelineStatus.tsx` — visualizador de estado en tiempo real | 1 día |
| T4 | `PipelineHistory.tsx` + ruta `/pipelines` + Nav link | 0.5 día |
| T5 | i18n es/en + tests E2E básicos | 0.5 día |

### Definition of Done
- [ ] Builder permite crear pipeline de hasta 5 steps con agentes reales del marketplace
- [ ] Ejecución muestra progreso step-by-step con estado visual
- [ ] Output de cada step visible al expandir
- [ ] Total cost USDC mostrado correctamente
- [ ] Error en mid-pipeline: step fallido marcado en rojo, steps previos visibles
- [ ] Historial de últimas 10 ejecuciones visible
- [ ] i18n es/en completo
- [ ] Responsive (mobile-friendly)
- [ ] `npm run build` 0 errores
- [ ] git push origin master master:main

### Modo NexusAgil
**QUALITY** — afecta UX de producto principal.

### Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Pipeline síncrono timeout en Vercel (>10s) | Alta | Medio | Mostrar advertencia "Pipelines largos recomiendan modo async" + CTA a jobs |
| UX compleja → builders no la usan | Media | Medio | MVP con 2-3 steps máximo en Sprint 15, expandir en Sprint 16 |

### Costo adicional
- `$0` — reutiliza APIs existentes.

---

---

## Deuda-WAS-74 — 6 menores críticos de Webhooks UI (Sprint 14)

> Source: `doc/sdd/014-webhooks-ui/ar-report.md` — 6 hallazgos MENOR post-AR del Sprint 14.

### Descripción técnica: los 6 menores

#### Minor #3 — Cron retría deliveries de webhooks inactivos
**Archivo:** `src/app/api/cron/retry-webhook-deliveries/route.ts`  
**Fix concreto:** En la query que busca webhooks por ID, agregar `.eq('is_active', true)`:
```typescript
const { data: webhooks } = await supabase
  .from('webhooks')
  .select('id, url, secret')
  .in('id', webhookIds)
  .eq('is_active', true)  // ← AÑADIR
```
Y en el bucle de deliveries, skip si `webhookMap.get(d.webhook_id)` es undefined.

#### Minor #4 — 50 HTTP calls paralelas sin control de concurrencia
**Archivo:** `src/app/api/cron/retry-webhook-deliveries/route.ts`  
**Fix concreto:** Instalar `p-limit` (ya en deps o agregar) y limitar a 10 concurrent:
```typescript
import pLimit from 'p-limit'
const limit = pLimit(10)
await Promise.allSettled(deliveries.map(d => limit(() => processDelivery(d))))
```

#### Minor #5 — handleToggle/handleDelete fallan silenciosamente
**Archivo:** `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`  
**Fix concreto:** Agregar `setError(...)` en los bloques de error actuales que solo hacen revert:
```typescript
// En handleToggle, bloque if (!res.ok):
setError(t('webhooks.toggleError') ?? 'No se pudo actualizar el webhook')
// En handleDelete, bloque if (!res.ok):
setError(t('webhooks.deleteError') ?? 'No se pudo eliminar el webhook')
```

#### Minor #6 — handleExpand sin manejo de errores
**Archivo:** `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`  
**Fix concreto:** Envolver en try/catch y setear estado vacío + mensaje:
```typescript
async function handleExpand(id: string) {
  try {
    const res = await fetch(`/api/v1/webhooks/${id}/deliveries`)
    if (!res.ok) throw new Error('fetch failed')
    const json = await res.json() as { deliveries?: Delivery[] }
    setDeliveriesMap(prev => ({ ...prev, [id]: json.deliveries ?? [] }))
  } catch {
    setDeliveriesMap(prev => ({ ...prev, [id]: [] }))
    setError(t('webhooks.deliveriesError') ?? 'Error al cargar historial')
  }
}
```

#### Minor #7 — Prop `userId` unused en WebhooksPanel
**Archivos:** `WebhooksPanel.tsx` + `src/app/[locale]/creator/dashboard/page.tsx`  
**Fix concreto:**
```typescript
// WebhooksPanel.tsx — eliminar de Props interface:
interface Props {}  // era: { userId: string }
export function WebhooksPanel() {  // era: ({ userId: _userId })
// page.tsx — eliminar el prop:
<WebhooksPanel />  // era: <WebhooksPanel userId={user.id} />
```

#### Minor #8 — deliveriesMap muestra datos stale
**Archivo:** `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`  
**Fix concreto:** Limpiar el mapa en `load()`:
```typescript
const load = useCallback(async () => {
  setLoading(true)
  setDeliveriesMap({})  // ← AÑADIR — invalida cache al recargar
  // ... resto sin cambios
}, [])
```

### Story Points
**3 SP** — 6 cambios quirúrgicos en 2 archivos, sin migración ni nueva infraestructura.

### Subtareas

| # | Subtarea | Estimado |
|---|----------|----------|
| T1 | Menores #3 y #4 — cron fixes (webhooks inactivos + p-limit) | 0.5 día |
| T2 | Menores #5, #6, #7, #8 — WebhooksPanel fixes (error handling + prop cleanup + cache) | 0.5 día |

### Definition of Done
- [ ] Cron no retría deliveries de webhooks con `is_active = false`
- [ ] Cron limitado a 10 HTTP calls concurrentes (p-limit)
- [ ] Toggle/delete muestran error visible en UI si falla
- [ ] handleExpand no queda en estado "loading" si falla
- [ ] Prop `userId` eliminado de WebhooksPanel sin romper nada
- [ ] Abrir WebhooksPanel → recargar → deliveries actualizadas (no stale)
- [ ] `npm run build` 0 errores
- [ ] git push origin master master:main

### Modo NexusAgil
**FAST** — ≤ 2 archivos, sin DB ni pagos.

### Riesgos
Bajo. Cambios quirúrgicos, todos con tests regresión en los builds existentes.

### Costo adicional
`$0` — `p-limit` puede ya estar en node_modules; si no, es dev dependency pura.

---

---

## Orden de ejecución recomendado

### Análisis de dependencias

```
Deuda-WAS-74  ─── sin deps ──→ PARALELO con todo
WAS-70        ─── sin deps ──→ debe ir ANTES de WAS-38 (UI usa el API)
WAS-75        ─── sin deps ──→ PARALELO con WAS-71 y WAS-70
WAS-71        ─── deseable WAS-70 done para pipeline payments, pero no bloqueante
WAS-38        ─── depende de WAS-70 (stretch: modo async), pero funciona con WAS-70 en paralelo
```

### Secuencia recomendada

```
Semana 1 (días 1-5)
├── Wave 0 (serial — 1 día): Deuda-WAS-74 → limpiar deuda, unblock trabajo limpio
├── Wave 1 (paralelo — 2 días):
│   ├── WAS-70 T1-T2: Crear POST /api/v1/jobs + process handler
│   └── WAS-75 T1-T2: Migration sandbox_credits + lib + POST /api/v1/sandbox/init
└── Wave 2 (paralelo — 2 días):
    ├── WAS-71 T1-T2: Migration agent_wallets + lib agentWallet.ts + endpoints
    └── WAS-75 T3-T4: POST /api/v1/sandbox/invoke + página /sandbox

Semana 2 (días 6-10)
├── Wave 3 (paralelo — 2 días):
│   ├── WAS-70 T3-T4: Webhook trigger job.completed + tests
│   └── WAS-38 T1-T2: PipelineBuilder + integración compose
├── Wave 4 (paralelo — 2 días):
│   ├── WAS-71 T3-T5: AgentWalletSection UI + integración invoke + tests
│   └── WAS-38 T3-T5: PipelineStatus + History + i18n
└── Buffer (1 día): AR global + correcciones menores + git push final
```

### Qué entra en Sprint 15 (capacidad 34 SP)

| ID | SP | Entra |
|----|----|----|
| Deuda-WAS-74 | 3 | ✅ |
| WAS-70 | 5 | ✅ |
| WAS-75 | 8 | ✅ |
| WAS-38 | 8 | ✅ |
| WAS-71 | 13 | ✅ — si el sprint va bien hasta Wave 3 |

**Total comprometido: 24 SP** (WAS-74 + WAS-70 + WAS-75 + WAS-38)  
**WAS-71 como stretch goal: +13 SP** → entra si velocidad del sprint lo permite.

> **Recomendación SM:** Comprometer 24 SP en Sprint Planning. WAS-71 se evalúa en mid-sprint review (miércoles 4 Mar). Si WAS-70 y WAS-75 van on-track, se activa WAS-71.

### Qué queda para Sprint 16

| ID | HU | Razón |
|----|----|-------|
| WAS-71 | Agentes con wallet propia | Si no entra en Sprint 15 (13 SP es pesado) |
| WAS-22 | Deploy contrato mainnet | Prerequisito WAS-71 en producción real |
| WAS-72 | Escrow tareas largas | Depende de WAS-70 done + diseño económico |
| WAS-39 | Migrar agentes a mainnet | Depende de WAS-22 |
| i18n-01 | Copy real es/en | P3, deuda acumulada |

---

## Métricas de capacidad

| Métrica | Valor |
|---------|-------|
| Velocidad Sprint 14 | 5 HUs completas, build 0 errores |
| SP totales propuestos | 37 |
| SP comprometidos (conservador) | 24 |
| SP con stretch (WAS-71) | 37 |
| Días hábiles estimados | 10 |
| Buffer para AR + correcciones | 1 día |

---

## Ceremonias Sprint 15

- **Planning:** 2026-03-02 (este documento)
- **Mid-sprint review:** 2026-03-04 (miércoles) — evaluar activar WAS-71
- **Demo + Retro:** ~2026-03-13
- **Sprint 16 Planning:** ~2026-03-16

---

*Documento generado por SM + Architect (San) — NexusAgil. Para aprobar: `SPRINT15_APPROVED`*
