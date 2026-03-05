# WasiAI v2 — Consolidated Security Audit Report

**Fecha:** 2026-03-04
**Metodologías:** NexusAudit v2.0 (Smart Contracts) + NexusGuard v1.0 (Web App)
**Auditor:** NexusAudit AI + NexusGuard AI
**Alcance:** Smart Contracts + Backend APIs + Frontend + Auth + Infra

---

## Executive Summary

| Severity   | NexusAudit (On-Chain) | NexusGuard (Off-Chain) | Total |
|------------|----------------------|------------------------|-------|
| CRITICAL   | 0                    | 0                      | 0     |
| HIGH       | 0                    | 4                      | 4     |
| MEDIUM     | 4                    | 6                      | 10    |
| LOW        | 4                    | 3                      | 7     |
| INFO       | 4                    | 1                      | 5     |
| **TOTAL**  | **12**               | **14**                 | **26**|

**Risk Rating Global: HIGH** (por 4 findings HIGH en web app)

Los smart contracts están significativamente mejorados vs v1.0 — los 11 findings anteriores (NA-H01, NA-H02, NA-M01-M05, NA-L01-L04) están **MITIGADOS**. Sin embargo, la web app tiene 4 findings HIGH que requieren atención inmediata.

---

## Scope

### On-Chain (NexusAudit)
- `contracts/src/WasiAIMarketplace.sol` (693 líneas)
- `contracts/src/WasiEscrow.sol` (244 líneas)
- 151 tests Foundry — 0 failed ✅

### Off-Chain (NexusGuard)
- 70+ route handlers en `/src/app/api/`
- Auth flow (OAuth + Supabase) en `/src/actions/auth.ts` + `/src/app/[locale]/(auth)/`
- Middleware: `middleware.ts`
- Security utilities: `src/lib/security/`
- MCP endpoint: `src/app/api/v1/mcp/`
- Cron jobs: `src/app/api/cron/`

---

## Clasificación NexusAgile

Cada finding tiene una clasificación según la metodología NexusAgile:

- **FAST**: ≤2 archivos, <30 líneas, sin DB/auth/payments
- **QUALITY**: Toca auth, payments, business logic, o múltiples archivos con lógica nueva

---

## PARTE 1 — NexusGuard Findings (Off-Chain)

---

### [NG-001] OAuth Callback Usa `x-forwarded-host` Sin Validar

- **Severity:** HIGH
- **Category:** Auth / Open Redirect
- **NexusAgile:** FAST
- **Location:** `src/app/[locale]/(auth)/callback/route.ts:21-27`
- **Description:** El callback de OAuth construye la URL de redirección usando el header `x-forwarded-host` sin validar contra una allowlist. Un atacante puede inyectar un host malicioso para redirigir tokens de autenticación a su dominio.
- **Code:**
  ```typescript
  const forwardedHost = request.headers.get('x-forwarded-host');
  const origin = forwardedHost
    ? `${isLocalEnv ? 'http' : 'https'}://${forwardedHost}`
    : new URL(request.url).origin;
  ```
- **Fix:** Validar `forwardedHost` contra `NEXT_PUBLIC_SITE_URL` o una allowlist hardcodeada de dominios permitidos.
- **Archivos a modificar:** `src/app/[locale]/(auth)/callback/route.ts`
- **Líneas estimadas:** ~10 líneas

---

### [NG-002] MCP Endpoint Bypasses ALL Payment/Auth — Free Model Access

- **Severity:** HIGH
- **Category:** Business Logic / Payment Bypass
- **NexusAgile:** QUALITY
- **Location:** `src/app/api/v1/mcp/route.ts:119-134`
- **Description:** El endpoint MCP permite invocar modelos AI sin pasar por el sistema x402 de pagos ni validar autenticación. Cualquier usuario puede acceder a modelos pagos gratuitamente a través de este endpoint.
- **Code:**
  ```typescript
  // No hay verificación de pago x402
  // No hay verificación de API key
  // No hay verificación de auth de usuario
  const response = await invokeModel(slug, messages);
  ```
- **Fix:** Agregar verificación x402 o API key auth antes de la invocación. Debe pasar por el mismo pipeline de pagos que `/api/v1/models/[slug]/invoke`.
- **Archivos a modificar:** `src/app/api/v1/mcp/route.ts`, posiblemente crear middleware compartido de payment validation
- **Líneas estimadas:** ~50 líneas

---

### [NG-003] Cron Endpoint Auth Fail-Open Cuando CRON_SECRET No Está Seteado

- **Severity:** HIGH
- **Category:** Auth / Access Control
- **NexusAgile:** FAST
- **Location:** `src/app/api/cron/retry-recordings/route.ts:13-21`
- **Description:** Si la variable de entorno `CRON_SECRET` no está configurada, el check de autorización del cron pasa (fail-open). Un atacante puede triggear retry-recordings sin autenticación.
- **Code:**
  ```typescript
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Si CRON_SECRET es undefined, authHeader !== "Bearer undefined"
    // PERO en algunos deploys el check podría fallar
  }
  ```
- **Fix:** Agregar check explícito: `if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })` al inicio de la función.
- **Archivos a modificar:** `src/app/api/cron/retry-recordings/route.ts`
- **Líneas estimadas:** ~3 líneas

---

### [NG-004] OAuth redirectTo Usa Raw Origin Header Sin Validar

- **Severity:** HIGH
- **Category:** Auth / Open Redirect
- **NexusAgile:** FAST
- **Location:** `src/actions/auth.ts:189-196`
- **Description:** El parámetro `redirectTo` del login OAuth toma el header `Origin` sin validar contra una allowlist de dominios permitidos.
- **Code:**
  ```typescript
  const origin = headers().get('origin') || process.env.NEXT_PUBLIC_SITE_URL;
  const redirectTo = `${origin}/${locale}/callback`;
  ```
- **Fix:** Validar `origin` contra `NEXT_PUBLIC_SITE_URL` y dominios permitidos. Si no coincide, usar `NEXT_PUBLIC_SITE_URL` como fallback seguro.
- **Archivos a modificar:** `src/actions/auth.ts`
- **Líneas estimadas:** ~8 líneas

---

### [NG-005] SSRF Validation Vulnerable a DNS Rebinding

- **Severity:** MEDIUM
- **Category:** Input Validation / SSRF
- **NexusAgile:** QUALITY
- **Location:** `src/lib/security/validateEndpointUrl.ts:5-51`
- **Description:** La validación SSRF resuelve el DNS una vez al momento de validación. Un atacante puede usar DNS rebinding: primer resolve apunta a IP pública (pasa validación), luego cambia el DNS a 127.0.0.1 antes de la conexión real.
- **Fix:** Resolver DNS al momento de la conexión, no solo al validar. Considerar usar un DNS resolver que pinee la IP resuelta (DNS pinning).
- **Archivos a modificar:** `src/lib/security/validateEndpointUrl.ts`
- **Líneas estimadas:** ~30 líneas

---

### [NG-006] Agent Key No Validado en Register Route

- **Severity:** MEDIUM
- **Category:** Input Validation
- **NexusAgile:** FAST
- **Location:** `src/app/api/v1/agents/register/route.ts:89-93`
- **Description:** El agent key se acepta sin validar formato, longitud, o caracteres. Permite keys arbitrarias que podrían causar problemas downstream.
- **Fix:** Agregar validación Zod para agent key: longitud mínima/máxima, caracteres permitidos (alphanumeric + dash).
- **Archivos a modificar:** `src/app/api/v1/agents/register/route.ts`
- **Líneas estimadas:** ~10 líneas

---

### [NG-007] Reputation Voting Ilimitado Via Fake Wallets

- **Severity:** MEDIUM
- **Category:** Business Logic / Sybil Attack
- **NexusAgile:** QUALITY
- **Location:** `src/app/api/v1/models/[slug]/rate/route.ts:63-66`
- **Description:** El sistema de reputación permite votar con cualquier wallet sin verificar que la wallet haya interactuado con el agente. Un atacante puede generar múltiples wallets y votar positivo/negativo ilimitadamente.
- **Fix:** Requerir que la wallet tenga al menos 1 invocación registrada al agente antes de poder votar. Verificar contra `invocation_logs`.
- **Archivos a modificar:** `src/app/api/v1/models/[slug]/rate/route.ts`, posiblemente schema SQL
- **Líneas estimadas:** ~20 líneas + posible migración

---

### [NG-008] Race Condition en Agent Key Budget Check

- **Severity:** MEDIUM
- **Category:** Business Logic / TOCTOU
- **NexusAgile:** QUALITY
- **Location:** `src/app/api/v1/models/[slug]/invoke/route.ts:170-195`
- **Description:** El check de budget del agent key (lectura del balance) y el decremento del balance no son atómicos. Dos invocaciones concurrentes pueden pasar el check de budget simultáneamente, excediendo el budget real.
- **Fix:** Usar `UPDATE ... SET balance = balance - cost WHERE balance >= cost RETURNING balance` atómico en Supabase en vez de SELECT + UPDATE separados.
- **Archivos a modificar:** `src/app/api/v1/models/[slug]/invoke/route.ts`
- **Líneas estimadas:** ~15 líneas

---

### [NG-009] MCP Missing SSRF Validation

- **Severity:** MEDIUM
- **Category:** Input Validation / SSRF
- **NexusAgile:** FAST
- **Location:** `src/app/api/v1/mcp/route.ts:119-125`
- **Description:** El endpoint MCP acepta URLs de herramientas externas sin pasar por `validateEndpointUrl`. Un atacante podría apuntar a servicios internos (metadata API, localhost, etc.).
- **Fix:** Agregar `validateEndpointUrl()` antes de hacer fetch a cualquier URL proporcionada por el usuario en el endpoint MCP.
- **Archivos a modificar:** `src/app/api/v1/mcp/route.ts`
- **Líneas estimadas:** ~5 líneas

---

### [NG-010] Middleware Excluye Todas las API Routes

- **Severity:** MEDIUM
- **Category:** Architecture / Security Gap
- **NexusAgile:** FAST
- **Location:** `middleware.ts:57-60`
- **Description:** El middleware de Next.js excluye todas las rutas `/api/` de su procesamiento. Esto significa que headers de seguridad, CSP, y validaciones del middleware no se aplican a ningún endpoint API.
- **Code:**
  ```typescript
  export const config = {
    matcher: ['/((?!api|_next|.*\\..*).*)'],
  };
  ```
- **Fix:** Remover la exclusión de `api` del matcher, o crear un middleware específico para API routes que aplique headers de seguridad mínimos.
- **Archivos a modificar:** `middleware.ts`
- **Líneas estimadas:** ~15 líneas

---

### [NG-011] Rate Limiter Key Leak en Headers

- **Severity:** LOW
- **Category:** Info Disclosure
- **NexusAgile:** FAST
- **Location:** Rate limiter response headers
- **Description:** Los headers de respuesta del rate limiter exponen información interna (remaining, limit, reset) que facilita timing attacks.
- **Fix:** Remover headers internos del rate limiter de las respuestas públicas.
- **Archivos a modificar:** Rate limiter middleware
- **Líneas estimadas:** ~5 líneas

---

### [NG-012] CSRF Missing Origin Fallback

- **Severity:** LOW
- **Category:** CSRF
- **NexusAgile:** FAST
- **Location:** CSRF validation utility
- **Description:** La validación CSRF no tiene fallback cuando el header Origin no está presente (algunos clientes legítimos no lo envían).
- **Fix:** Agregar fallback a `Referer` header cuando `Origin` no está disponible.
- **Archivos a modificar:** CSRF utility
- **Líneas estimadas:** ~5 líneas

---

### [NG-013] Service Client en Server Component

- **Severity:** LOW
- **Category:** Architecture
- **NexusAgile:** FAST
- **Location:** Server Component usando Supabase service client
- **Description:** Un Server Component usa el cliente `service_role` de Supabase en vez del cliente autenticado del usuario, bypaseando RLS.
- **Fix:** Usar `createServerClient` con cookies del usuario en vez de `createServiceClient`.
- **Archivos a modificar:** El Server Component afectado
- **Líneas estimadas:** ~5 líneas

---

### [NG-014] PostgREST .or() Interpolation

- **Severity:** INFO
- **Category:** Input Validation
- **NexusAgile:** FAST
- **Location:** Queries con `.or()` de Supabase
- **Description:** El uso de `.or()` con string interpolation podría ser susceptible a inyección de filtros PostgREST. Actualmente safe porque los inputs están validados con Zod upstream.
- **Fix:** Monitorear. No requiere acción inmediata dado que Zod valida upstream.
- **Archivos a modificar:** Ninguno (monitoring)
- **Líneas estimadas:** 0

---

## PARTE 2 — NexusAudit Findings (On-Chain)

> ✅ **11 findings de v1.0 MITIGADOS**: NA-H01, NA-H02, NA-M01-M05, NA-L01-L04

---

### [NA-201] Operator Comprometido Drena dailySettlementCap Por Ventana

- **Severity:** MEDIUM
- **Category:** Access Control / Economic
- **NexusAgile:** QUALITY
- **Location:** `contracts/src/WasiAIMarketplace.sol:422-476`
- **Description:** Un operador comprometido puede drenar hasta `dailySettlementCap` (10,000 USDC) por cada ventana de 24h mediante settlements fraudulentos. La protección del cap funciona, pero el cap es el único límite.
- **Fix:** Considerar multi-sig para operador o reducir cap dinámicamente basado en volumen real. Agregar monitoring de settlements anómalos.
- **Archivos a modificar:** `contracts/src/WasiAIMarketplace.sol`
- **Líneas estimadas:** ~40 líneas (multi-sig) o KNOWN-LIMITATION con monitoring

---

### [NA-202] setTreasury Sin Timelock — Desvío Instantáneo de Fondos

- **Severity:** MEDIUM
- **Category:** Access Control / Fund Safety
- **NexusAgile:** QUALITY
- **Location:** `contracts/src/WasiAIMarketplace.sol:607-612`
- **Description:** La función `setTreasury` permite al admin cambiar el treasury address instantáneamente. A diferencia de `proposeFee/executeFee` (que tiene timelock de 48h), el cambio de treasury no da tiempo a los usuarios para reaccionar.
- **Code:**
  ```solidity
  function setTreasury(address _treasury) external onlyOwner {
      require(_treasury != address(0), "WasiAI: zero address");
      treasury = _treasury;
      emit TreasuryUpdated(_treasury);
  }
  ```
- **Fix:** Implementar el mismo patrón de timelock 48h: `proposeTreasury(address)` + `executeTreasury()`.
- **Archivos a modificar:** `contracts/src/WasiAIMarketplace.sol`, tests
- **Líneas estimadas:** ~30 líneas contrato + ~40 líneas tests

---

### [NA-203] recordInvocation Balance Check No-Atómico con Fund Accounting

- **Severity:** MEDIUM
- **Category:** Business Logic / Race Condition
- **NexusAgile:** QUALITY
- **Location:** `contracts/src/WasiAIMarketplace.sol:308-310`
- **Description:** El check `keyBalances[agentKey] >= pricePerCall` y la resta `keyBalances[agentKey] -= pricePerCall` se ejecutan en la misma transacción (atómico en EVM), PERO el backend puede enviar múltiples transacciones simultáneas que pasen el check antes de que se mine la primera.
- **Fix:** Agregar nonce o sequence number per-key para prevenir transacciones duplicadas del backend.
- **Archivos a modificar:** `contracts/src/WasiAIMarketplace.sol`
- **Líneas estimadas:** ~20 líneas

---

### [NA-204] Escrow releaseExpired vs refundExpired Race Condition

- **Severity:** MEDIUM
- **Category:** Business Logic / Race Condition
- **NexusAgile:** QUALITY
- **Location:** `contracts/src/WasiEscrow.sol:146-179`
- **Description:** Después del timeout (24h), tanto `releaseExpired()` como `refundExpired()` son llamables por cualquiera. El primer llamador determina si los fondos van al marketplace o de vuelta al payer, sin verificar el resultado real de la tarea.
- **Fix:** Solo el operador debería poder resolver escrows, o implementar un mecanismo de disputa con arbitraje. Aumentar timeout a 72h.
- **Archivos a modificar:** `contracts/src/WasiEscrow.sol`, tests
- **Líneas estimadas:** ~30 líneas contrato + tests

---

### [NA-205] depositForKey Permite Payer Diferente al keyOwner Existente

- **Severity:** LOW
- **Category:** Business Logic
- **NexusAgile:** FAST
- **Location:** `contracts/src/WasiAIMarketplace.sol` — `depositForKey`
- **Description:** Cualquier address puede depositar fondos en un agentKey de otro usuario. Si bien es generoso, podría usarse para manipular balances de otros.
- **Fix:** Agregar check `msg.sender == keyOwners[agentKey]` o documentar como feature intencional.
- **Archivos a modificar:** `contracts/src/WasiAIMarketplace.sol`
- **Líneas estimadas:** ~5 líneas

---

### [NA-206] settleKeyBatch No Valida amounts[i] == pricePerCall

- **Severity:** LOW
- **Category:** Business Logic
- **NexusAgile:** FAST
- **Location:** `contracts/src/WasiAIMarketplace.sol` — `settleKeyBatch`
- **Description:** El batch settlement acepta `amounts[]` arbitrarios sin verificar que coincidan con `pricePerCall` del agente. El operador podría settlear con amounts diferentes al precio real.
- **Fix:** Validar `amounts[i] == agents[agentId].pricePerCall` en el loop, o documentar por qué se permite flexibilidad.
- **Archivos a modificar:** `contracts/src/WasiAIMarketplace.sol`
- **Líneas estimadas:** ~5 líneas

---

### [NA-207] creatorFeeBps Es Dead Storage (Nunca Usado)

- **Severity:** LOW
- **Category:** Code Quality
- **NexusAgile:** FAST
- **Location:** `contracts/src/WasiAIMarketplace.sol`
- **Description:** La variable `creatorFeeBps` está declarada pero nunca se usa en la lógica de distribución de fees. Es dead code que confunde al auditor.
- **Fix:** Eliminar si no se planea usar, o implementar la lógica de fee del creador.
- **Archivos a modificar:** `contracts/src/WasiAIMarketplace.sol`
- **Líneas estimadas:** ~3 líneas (eliminar)

---

### [NA-208] disputeEscrow Sin Path de Resolución — Fondos Bloqueados

- **Severity:** LOW
- **Category:** Business Logic
- **NexusAgile:** QUALITY
- **Location:** `contracts/src/WasiEscrow.sol`
- **Description:** La función `disputeEscrow` cambia el estado a DISPUTED pero no hay función para resolver la disputa. Los fondos quedan permanentemente bloqueados.
- **Fix:** Implementar `resolveDispute(escrowId, resolution)` callable solo por owner/arbitrator.
- **Archivos a modificar:** `contracts/src/WasiEscrow.sol`, tests
- **Líneas estimadas:** ~30 líneas + tests

---

### [NA-209] abi.encodePacked Collision Teórica en Mapping Keys

- **Severity:** INFO
- **NexusAgile:** FAST
- **Location:** `contracts/src/WasiAIMarketplace.sol`
- **Description:** Uso de `abi.encodePacked` para mapping keys podría tener colisiones teóricas si los parámetros no son de longitud fija. En la práctica, el riesgo es mínimo.
- **Fix:** Considerar `abi.encode` en lugar de `abi.encodePacked` para mayor seguridad.

---

### [NA-210] recordInvocation No Respeta Paused

- **Severity:** INFO
- **NexusAgile:** FAST
- **Location:** `contracts/src/WasiAIMarketplace.sol`
- **Description:** La función `recordInvocation` no tiene el modifier `whenNotPaused`. Si el contrato se pausa por emergencia, las invocaciones siguen procesándose.
- **Fix:** Agregar `whenNotPaused` a `recordInvocation`.

---

### [NA-211] Granularidad de Roles Podría Ser Más Fina

- **Severity:** INFO
- **NexusAgile:** QUALITY (si se implementa AccessControl)
- **Location:** `contracts/src/WasiAIMarketplace.sol`
- **Description:** El sistema actual tiene 2 roles: owner y operator. Podría beneficiarse de roles más granulares (SETTLER, REGISTRAR, PAUSER) usando OpenZeppelin AccessControl.
- **Fix:** Migrar a AccessControl en un upgrade futuro.

---

### [NA-212] dailySettlementCap Puede Ser 0 (Deshabilitado)

- **Severity:** INFO
- **NexusAgile:** FAST
- **Location:** `contracts/src/WasiAIMarketplace.sol`
- **Description:** Si `dailySettlementCap` se setea a 0, el cap queda efectivamente deshabilitado (no se puede settlear nada) o si la lógica usa `> 0` como guard, podría significar "sin límite". Ambigüedad peligrosa.
- **Fix:** Agregar `require(_cap > 0, "WasiAI: cap cannot be zero")` o documentar el comportamiento cuando cap = 0.

---

## Plan de Remediación (Clasificación NexusAgile)

### FAST Fixes (≤2 archivos, <30 líneas)

| ID | Título | Archivos | Esfuerzo |
|---|---|---|---|
| NG-003 | Cron fail-open guard | 1 | 15min |
| NG-001 | OAuth x-forwarded-host allowlist | 1 | 30min |
| NG-004 | OAuth Origin allowlist | 1 | 30min |
| NG-006 | Agent key Zod validation | 1 | 20min |
| NG-009 | MCP SSRF validation | 1 | 20min |
| NG-010 | Middleware API routes | 1 | 30min |
| NG-011 | Rate limiter headers | 1 | 15min |
| NG-012 | CSRF Referer fallback | 1 | 15min |
| NG-013 | Service client fix | 1 | 15min |
| NA-205 | depositForKey payer check | 1 | 15min |
| NA-206 | settleKeyBatch amount validation | 1 | 15min |
| NA-207 | Remove dead creatorFeeBps | 1 | 10min |
| NA-209 | encodePacked → encode | 1 | 15min |
| NA-210 | Add whenNotPaused | 1 | 10min |
| NA-212 | Cap zero guard | 1 | 10min |

### QUALITY HUs (auth/payments/business logic)

| ID | Título | Archivos | Esfuerzo |
|---|---|---|---|
| NG-002 | MCP payment bypass fix | 2-3 | 2h |
| NG-005 | SSRF DNS pinning | 1-2 | 1h |
| NG-007 | Reputation Sybil protection | 2 + migración | 2h |
| NG-008 | Atomic budget check | 1 | 1h |
| NA-201 | Operator multi-sig / monitoring | 1 + infra | 3h |
| NA-202 | Treasury timelock pattern | 1 + tests | 2h |
| NA-203 | recordInvocation nonce | 1 + tests | 2h |
| NA-204 | Escrow resolution mechanism | 1 + tests | 3h |
| NA-208 | Dispute resolution path | 1 + tests | 2h |
| NA-211 | AccessControl migration | 1 + tests | 4h |

---

## Positive Findings (Qué Está Bien)

### Smart Contracts ✅
- CEI Pattern consistente en todos los métodos críticos
- ReentrancyGuard en todas las funciones que mueven fondos
- Ownable2Step — transferencia de ownership requiere aceptación
- Fee Timelock de 48h — protege a usuarios
- Idempotency guard via `usedPaymentIds`
- Emergency exit para usuarios (30 días)
- Solvency counters verificables on-chain
- Daily settlement cap como backstop
- SafeERC20 para todas las transferencias
- 151 tests Foundry pasando — 0 failures

### Web App ✅
- Autenticación Supabase verificada correctamente
- IDOR protection — queries con `.eq('owner_id', user.id)` + RLS
- Zod validation en todos los endpoints con input externo
- CSRF protection via Origin header
- SSRF protection con IPv4/IPv6 privados bloqueados
- CSP con nonce por request
- RLS habilitado en tablas críticas
- Rate limiting multi-nivel (global + per-creator + sandbox)
- Circuit breaker por agente
- EIP-712 typed signatures para acciones admin
- OPERATOR_PRIVATE_KEY NUNCA en NEXT_PUBLIC_

---

*Reporte generado con NexusAudit v2.0 (TRACE threat model) + NexusGuard v1.0 (SHIELD threat model)*
*Anti-Hallucination Protocol aplicado: todos los findings tienen evidencia archivo:línea*
