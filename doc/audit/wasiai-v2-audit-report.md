# WasiAI v2 — Security Audit Report

**Fecha:** 2026-03-03  
**Metodología:** NexusAudit + Web2 Security Review  
**Auditor:** NexusAudit AI (San)  
**Alcance:** Smart Contracts + Backend APIs + Frontend + Infraestructura  

---

## Executive Summary

| Severity   | Count |
|------------|-------|
| CRITICAL   | 0     |
| HIGH       | 2     |
| MEDIUM     | 4     |
| LOW        | 3     |
| INFO       | 3     |
| **TOTAL**  | **12** |

El protocolo WasiAI v2 demuestra un nivel de madurez de seguridad alto para un proyecto Web3 en producción temprana. Los contratos Solidity implementan correctamente ReentrancyGuard, CEI pattern, Ownable2Step, fee timelock, y solvency counters. Las APIs aplican autenticación, CSRF, validación con Zod, y protección SSRF. El hallazgo más crítico es un **mismatch funcional entre el ABI backend y el contrato desplegado** que rompe completamente la gestión de fees de la plataforma. El segundo hallazgo alto es una **brecha en `.gitignore`** que expone `.env` a commits accidentales.

---

## Scope

- **Contratos Solidity:** `WasiAIMarketplace.sol` (29 KB), `WasiEscrow.sol` (9.5 KB), `MockUSDC.sol`
- **Backend:** 40 route handlers en `/src/app/api/`
- **Frontend:** Next.js 15 + wagmi/viem, middleware de auth + CSP
- **Infra:** Vercel + Supabase (RLS) + Upstash Redis + Pinata IPFS
- **Tests:** 151 tests Foundry — 0 failed ✅
- **Forge Build:** 0 errores, 2 warnings (ver findings)

---

## Findings

---

### [NA-001] ABI/Contrato Mismatch — `setPlatformFee` no existe en WasiAIMarketplace.sol

- **Severity:** HIGH
- **Category:** Smart Contract / Backend
- **Confidence:** CONFIRMED
- **Location:**
  - `src/app/api/admin/fee/route.ts:72` → `functionName: 'setPlatformFee'`
  - `src/lib/contracts/WasiAIMarketplace.ts:104` → ABI define `setPlatformFee`
  - `contracts/src/WasiAIMarketplace.sol` → función NO existe; reemplazada por `proposeFee()` + `executeFee()` (fee timelock de 48h)
- **Description:** El backend llama a `setPlatformFee(bps)` via el ABI legacy, pero el contrato desplegado ya no tiene esa función. El sprint anterior migró a un sistema de timelock de 2 pasos (`proposeFee → executeFee`). El ABI no fue actualizado.
- **Attack Path:** Un admin legítimo intenta cambiar el platform fee desde el panel → la tx revierte con `function not found` → el fee no puede ser modificado via UI. Más peligroso: si el contrato fuera re-desplegado con el ABI viejo, `setPlatformFee` permitiría cambio inmediato de fee sin timelock, eliminando la protección NA-M03 que fue diseñada para proteger a los usuarios.
- **Impact:** Gestión de fees completamente rota en producción. El admin no puede modificar `platformFeeBps` via el panel. Si se despliega un contrato con ABI viejo, el timelock queda bypasseado.
- **Fix Type:** FAST-FIX
- **Recommendation:**
  1. Actualizar `src/lib/contracts/WasiAIMarketplace.ts` para incluir `proposeFee(uint16)` y `executeFee()` en el ABI, eliminando `setPlatformFee`.
  2. Actualizar `src/app/api/admin/fee/route.ts` para usar el flujo de 2 pasos: POST propone, segundo endpoint ejecuta después de 48h.
  3. Agregar test de integración que verifique que el ABI del backend coincide con las funciones del contrato desplegado (usando `forge inspect` en CI).

---

### [NA-002] `.gitignore` no protege `.env` — Solo protege `.env*.local`

- **Severity:** HIGH
- **Category:** Infra
- **Confidence:** CONFIRMED
- **Location:** `.gitignore` líneas relevantes:
  ```
  .env*.local
  .env.local
  ```
- **Description:** El `.gitignore` solo ignora archivos que terminan en `.local` (e.g., `.env.local`, `.env.development.local`). El archivo `.env` o `.env.production` en el directorio raíz NO está ignorado. Si un desarrollador crea un `.env` con secrets reales y hace `git add .`, se commitea al repositorio.
- **Attack Path:** Developer crea `.env` con `OPERATOR_PRIVATE_KEY=0x...` y `SUPABASE_SERVICE_ROLE_KEY=...` → `git add . && git commit` → archivo con secrets en historial de Git → si el repo es público o el access token se filtra, atacante drena todos los fondos del operador y accede a toda la DB de Supabase.
- **Impact:** Exposure completa de `OPERATOR_PRIVATE_KEY` (fondos on-chain), `SUPABASE_SERVICE_ROLE_KEY` (acceso total a DB sin RLS), `CRON_SECRET`, `AGENT_WALLET_ENCRYPTION_KEY`.
- **Fix Type:** FAST-FIX
- **Recommendation:**
  Agregar al `.gitignore`:
  ```
  # Environment variables — ALL variants
  .env
  .env.*
  !.env.example
  ```
  Verificar historial de Git con `git log --all --full-history -- .env` para asegurar que ningún `.env` fue commiteado.

---

### [NA-003] `verifyAdminSignature` acepta `NEXT_PUBLIC_OPERATOR_ADDRESS` como dirección admin — Hot wallet como admin

- **Severity:** MEDIUM
- **Category:** Backend / Infra
- **Confidence:** CONFIRMED
- **Location:** `src/lib/admin/verifyAdminSignature.ts:3-8`
  ```typescript
  const ALLOWED_ADDRESSES = [
    process.env.WASIAI_OWNER_ADDRESS,
    process.env.NEXT_PUBLIC_WASIAI_OWNER,
    process.env.NEXT_PUBLIC_OPERATOR_ADDRESS,  // ← PROBLEMA
  ]
  ```
- **Description:** El sistema de firma EIP-712 para acciones admin permite que la dirección del operador (`NEXT_PUBLIC_OPERATOR_ADDRESS`) autorice acciones de gestión de fees. El operador es una hot wallet utilizada en procesos automáticos del backend (settlements, recordInvocations, etc.). Mezclar este rol con privilegios admin crea un radio de explosión elevado si la clave del operador se compromete.
- **Attack Path:** Atacante obtiene `OPERATOR_PRIVATE_KEY` (ej. leak de CI/CD, acceso al server) → firma un `AdminAction` EIP-712 con `action: 'setPlatformFee'` → puede modificar fees de la plataforma → combinado con front-running, puede maximizar extracción antes de que el owner lo detecte.
- **Impact:** Compromiso del operador escala a privilegios admin. Permite proponer fees hasta 30% e intentar ejecutarlos (aunque el timelock de 48h mitiga en el contrato, la propuesta maliciosa queda registrada).
- **Fix Type:** HU-MINOR
- **Recommendation:** Separar roles: `WASIAI_OWNER_ADDRESS` debe ser la única dirección autorizada para acciones admin. Eliminar `NEXT_PUBLIC_OPERATOR_ADDRESS` del array `ALLOWED_ADDRESSES`. Documentar que el Owner debe ser una cold wallet / multisig.

---

### [NA-004] Rate limiting falla abierto cuando Upstash no está disponible

- **Severity:** MEDIUM
- **Category:** Backend / Infra
- **Confidence:** CONFIRMED
- **Location:** `src/app/api/v1/models/[slug]/invoke/route.ts` — comentario `AR-fix: fail-open — checkCreatorRateLimits retorna null si Upstash no está disponible`
- **Description:** Si Upstash Redis está caído o hay timeout de red, el sistema de rate limiting (tanto global como el per-creator/model) retorna `null` y permite todas las llamadas sin restricción. Esto es una decisión explícita de diseño para maximizar disponibilidad.
- **Attack Path:** Atacante detecta o provoca una interrupción de Upstash (e.g., DNS spoofing, red flaky) → durante la ventana de outage, realiza invocaciones masivas a agentes → drena el budget de API keys de otros usuarios o genera cargos fraudulentos → el daily cap on-chain (10,000 USDC) es el único backstop que permanece activo.
- **Impact:** Abuso de API durante outages de Upstash. El daily cap on-chain limita el daño económico máximo a 10,000 USDC/día.
- **Fix Type:** HU-MINOR
- **Recommendation:** En lugar de fail-open silencioso, considerar: (1) un rate limiter de fallback en memoria (in-process, limita por proceso), o (2) retornar 503 durante outages prolongados de Upstash con `Retry-After: 60`. Loggear métricas de fallos de Upstash para detectar patrones de abuse durante outages.

---

### [NA-005] Endpoints internos de agentes sin autenticación

- **Severity:** MEDIUM
- **Category:** Backend
- **Confidence:** CONFIRMED
- **Location:** `src/app/api/v1/agents-internal/wasi-contract-auditor/route.ts`, `wasi-risk-report/route.ts`, `wasi-defi-sentiment/route.ts`, `wasi-onchain-analyzer/route.ts`, `wasi-chainlink-price/route.ts`
- **Description:** Los endpoints bajo `/api/v1/agents-internal/` no tienen ningún mecanismo de autenticación. Cualquier usuario (anónimo) puede llamar directamente a estos endpoints usando `GROQ_API_KEY` del servidor sin pagar. El path `-internal` sugiere que deberían ser privados, pero no hay ningún guard.
- **Attack Path:** Atacante descubre el path `/api/v1/agents-internal/wasi-contract-auditor` → realiza miles de llamadas → agota el crédito de `GROQ_API_KEY` del servidor → los agentes internos dejan de funcionar → impacto económico en la cuenta de Groq.
- **Impact:** Uso gratuito ilimitado de capacidades AI del servidor (Groq inference), costos inesperados, agotamiento de créditos.
- **Fix Type:** FAST-FIX
- **Recommendation:** Agregar autenticación: validar `x-agent-key` (API key válida con budget) antes de procesar, o proteger estos endpoints con `INTERNAL_API_SECRET`. Si son para uso interno del invoke pipeline, bloquear acceso público completamente via middleware.

---

### [NA-006] `creator_profiles` — lectura pública total incluyendo `wallet_address`

- **Severity:** LOW
- **Category:** Infra / Backend
- **Confidence:** CONFIRMED
- **Location:** `supabase/migrations/00000000000003_wasiai_core.sql:80`
  ```sql
  CREATE POLICY "profiles_public_read" ON creator_profiles FOR SELECT USING (true);
  ```
- **Description:** Todos los perfiles de creadores son legibles públicamente sin autenticación. Si la tabla incluye campos sensibles más allá de nombre/bio (emails, wallets, configuraciones privadas), estos quedan expuestos. Actualmente se sabe que incluye `wallet_address`.
- **Attack Path:** Atacante hace `SELECT * FROM creator_profiles` via Supabase JS SDK con anon key → obtiene lista completa de wallets de todos los creadores → usa esta información para targeting (phishing, social engineering, front-running de withdrawals).
- **Impact:** Enumeración de todos los wallets de creadores. Menor impacto ya que las wallets son pseudo-públicas en blockchain, pero facilita targeted attacks.
- **Fix Type:** HU-MINOR
- **Recommendation:** Revisar qué columnas de `creator_profiles` necesitan ser verdaderamente públicas. Considerar crear una vista pública `creator_public_profiles` con solo campos que el marketplace necesita mostrar (display_name, bio, avatar, slug), y restringir `wallet_address` a solo el owner.

---

### [NA-007] `WasiEscrow.releaseExpired` libera fondos al Marketplace (no al payer) sin discriminación

- **Severity:** LOW
- **Category:** Smart Contract
- **Confidence:** CONFIRMED
- **Location:** `contracts/src/WasiEscrow.sol:130-148`
- **Description:** Después del `RELEASE_TIMEOUT` (24h), cualquier actor puede llamar `releaseExpired()` enviando los fondos al contrato Marketplace (suponiendo que el agente completó exitosamente). O puede llamar `refundExpired()` devolviendo fondos al payer. No hay forma de determinar on-chain cuál es el resultado correcto — queda a discreción del primer llamador. El timeout de 24h es muy agresivo para agentes de tareas largas.
- **Attack Path:** Un agente legítimo completa su tarea en 22h. El operador está procesando el resultado. A las 24h exactas, un bot (posiblemente del mismo payer) llama `refundExpired()` antes del operador → payer recupera sus fondos Y el agente no cobra. O alternativamente, alguien llama `releaseExpired()` para una tarea fallida, enviando fondos al marketplace incorrectamente.
- **Impact:** Race condition entre operador y bots — payer podría doble-cobrar (recuperar fondos de tarea completada). O fondos routing incorrecto en tareas fallidas.
- **Fix Type:** KNOWN-LIMITATION (el diseño es intencional como escape hatch, pero el timeout es muy corto)
- **Recommendation:** Considerar aumentar `RELEASE_TIMEOUT` a 72h para dar más margen al operador. Documentar claramente en el UI que escrows mayores a 24h pueden ser resueltos por cualquiera.

---

### [NA-008] Forge warning: `divide-before-multiply` en producción (WasiAIMarketplace)

- **Severity:** LOW
- **Category:** Smart Contract
- **Confidence:** CONFIRMED
- **Location:** Forge lint reporta el warning pero la inspección manual confirma que el warning es del archivo de test `test/WasiAIMarketplace.t.sol:1111`, NO del contrato de producción.
  ```
  uint256 totalFee = (PRICE * 1000 / 10000) * n;  // test file only
  ```
  En el contrato de producción, las operaciones de fee usan: `(amount * platformFeeBps) / 10_000` — división DESPUÉS de multiplicación. ✅
- **Attack Path:** N/A — solo está en archivo de test.
- **Impact:** No hay impacto en producción. El test calcula fees de forma ligeramente imprecisa, pero no afecta al protocolo.
- **Fix Type:** FAST-FIX (cosmético)
- **Recommendation:** Corregir en test: `(PRICE * 1000 / 10000) * n` → `(PRICE * 1000 * n) / 10000` para mantener consistencia y eliminar el warning de forge lint.

---

### [NA-009] CORS wildcard `Access-Control-Allow-Origin: *` en endpoint de invocación pública

- **Severity:** INFO
- **Category:** Backend
- **Confidence:** CONFIRMED
- **Location:** `src/app/api/v1/agents/[slug]/invoke/route.ts:8`
  ```typescript
  'Access-Control-Allow-Origin': '*',
  ```
- **Description:** El endpoint de invocación de agentes permite llamadas desde cualquier origen. Esto es intencional para permitir integración desde cualquier frontend/agente externo. Sin embargo, combina mal con headers de autenticación (X-API-Key) expuestos en `Access-Control-Allow-Headers: X-API-Key`.
- **Attack Path:** Página web maliciosa puede potencialmente usar un API key robado para realizar invocaciones cross-origin. Sin embargo, no hay cookies de sesión en juego, y el API key ya requeriría ser obtenido por otros medios.
- **Impact:** Ninguno adicional — el API key es el control de acceso real. Wildcard CORS es común en APIs públicas.
- **Fix Type:** KNOWN-LIMITATION
- **Recommendation:** Documentar que este es comportamiento intencional para una API pública. Si en el futuro se agregan endpoints que usan cookies de sesión en lugar de API keys, revisar la política CORS.

---

### [NA-010] `NEXT_PUBLIC_OPERATOR_ADDRESS` y `NEXT_PUBLIC_WASIAI_OWNER` como variables públicas en `verifyAdminSignature`

- **Severity:** INFO
- **Category:** Infra
- **Confidence:** CONFIRMED
- **Location:** `src/lib/admin/verifyAdminSignature.ts:4-5`
- **Description:** Las variables `NEXT_PUBLIC_WASIAI_OWNER` y `NEXT_PUBLIC_OPERATOR_ADDRESS` están disponibles en el bundle del cliente (por ser `NEXT_PUBLIC_`), y también se usan en `verifyAdminSignature` en el servidor. Aunque las direcciones Ethereum son públicas por naturaleza (aparecen en transacciones on-chain), su exposición explícita en el código del cliente permite que un atacante pre-compute mensajes EIP-712 válidos para testear la robustez del sistema.
- **Impact:** Facilita reconocimiento — atacante sabe exactamente qué wallets tienen privilegios admin sin necesidad de leer contratos on-chain.
- **Fix Type:** FAST-FIX (cosmético)
- **Recommendation:** Usar `WASIAI_OWNER_ADDRESS` (sin `NEXT_PUBLIC_`) para la variable server-side en `verifyAdminSignature`. Las versiones `NEXT_PUBLIC_` pueden mantenerse para el frontend si son necesarias para firmar mensajes, pero separarlas del check de autorización server-side.

---

### [NA-011] Forge lint warning: `unwrapped-modifier-logic` en `onlyOperator` — code size

- **Severity:** INFO
- **Category:** Smart Contract
- **Confidence:** CONFIRMED
- **Location:** `contracts/src/WasiAIMarketplace.sol:160` — `onlyOperator` modifier
  ```
  note[unwrapped-modifier-logic]: wrap modifier logic to reduce code size
  ```
- **Description:** El modifier `onlyOperator` contiene lógica que forge lint sugiere mover a una función interna para reducir el bytecode desplegado (cada uso del modifier duplica el bytecode). No es una vulnerabilidad de seguridad.
- **Impact:** Bytecode ligeramente más grande. No hay impacto de seguridad.
- **Fix Type:** FAST-FIX (optimización)
- **Recommendation:** Refactorizar:
  ```solidity
  function _checkOperator() internal view {
    require(operators[msg.sender] || msg.sender == owner(), "WasiAI: not operator");
  }
  modifier onlyOperator() { _checkOperator(); _; }
  ```

---

## Known Limitations

1. **Operador único (hot wallet):** La arquitectura de operador único es una limitación arquitectural conocida. Un compromiso de `OPERATOR_PRIVATE_KEY` permite: manipulación de settlements, registro falso de agentes, y ejecución de withdrawals fraudulentos. La mitigación ideal es un multi-sig de operadores (WAS-110+ según el código).

2. **Daily settlement cap:** El `dailySettlementCap` de 10,000 USDC protege contra settlements maliciosos, pero también puede bloquear operaciones legítimas en días de alto volumen. No es fixeable sin un análisis de baseline de volumen real.

3. **Chainlink Automation — `performUpkeep` sin access control:** Cualquier address puede llamar `performUpkeep`. La protección es el `UPKEEP_INTERVAL` (23h). En la práctica esto es una KNOWN-LIMITATION del estándar de Chainlink Automation.

4. **x402 payment flow — confianza en facilitador externo:** El flujo x402 en mainnet depende del `facilitator.ultravioletadao.xyz` para verificar y liquidar pagos. Si este servicio cambia de comportamiento, podría haber pagos verificados incorrectamente. Riesgo aceptable dado que es infraestructura del mismo equipo.

---

## Positive Findings (qué está bien)

### Contratos Solidity
- ✅ **CEI Pattern** consistente en todos los métodos críticos — estado antes de transferencias
- ✅ **ReentrancyGuard** en todas las funciones que mueven fondos
- ✅ **Ownable2Step** — transferencia de ownership requiere aceptación explícita
- ✅ **Fee Timelock de 48h** — protege a usuarios de cambios abruptos de fees
- ✅ **Idempotency guard** en `recordInvocation` via `usedPaymentIds`
- ✅ **Emergency exit** para usuarios (30 días sin operador → `emergencyWithdrawKey`)
- ✅ **Solvency counters** (`totalKeyBalances + totalEarnings`) verificables on-chain
- ✅ **Daily settlement cap** como backstop contra settlements maliciosos
- ✅ **SafeERC20** para todas las transferencias de USDC
- ✅ **151 tests Foundry pasando — 0 failures**

### Backend APIs
- ✅ **Autenticación Supabase** verificada correctamente antes de operaciones críticas
- ✅ **IDOR protection** — queries con `.eq('owner_id', user.id)` y RLS como doble capa
- ✅ **Zod validation** en todos los endpoints que aceptan input externo
- ✅ **CSRF protection** via Origin header en todos los endpoints mutantes
- ✅ **SSRF protection** (`validateEndpointUrl`) con IPv4 e IPv6 privados bloqueados
- ✅ **CRON_SECRET** verificado antes de ejecutar cualquier cron
- ✅ **HAL-025** — refund abort si on-chain falla (protege fondos del usuario)
- ✅ **HAL-027** — receipt signatures para auditoría de llamadas
- ✅ **EIP-712 typed signatures** para acciones admin (con anti-replay de 5 minutos)

### Frontend / Infra
- ✅ **CSP con nonce** por request (sin `unsafe-inline` para scripts)
- ✅ **RLS habilitado** en todas las tablas críticas
- ✅ **`agent_wallets` con policy `service_only`** — solo service_role puede leer wallets encriptados
- ✅ **`system_config` con policy `service_only`** — no expuesto a usuarios
- ✅ **Rate limiting** via Upstash con múltiples niveles (global + per-creator + sandbox)
- ✅ **Circuit breaker** por agente para proteger disponibilidad
- ✅ **`OPERATOR_PRIVATE_KEY` NUNCA en NEXT_PUBLIC_** — confirmado

---

## Recommended Sprint Backlog (Sprint 19/20)

### 🔴 Alta prioridad (bloquea operación)

| ID     | Título                                        | Tipo      | Esfuerzo |
|--------|-----------------------------------------------|-----------|----------|
| NA-001 | Fix ABI mismatch: setPlatformFee → proposeFee/executeFee | FAST-FIX  | 2h |
| NA-002 | Fix .gitignore para proteger `.env`           | FAST-FIX  | 15min |

### 🟡 Media prioridad (reduce superficie de ataque)

| ID     | Título                                                    | Tipo      | Esfuerzo |
|--------|-----------------------------------------------------------|-----------|----------|
| NA-003 | Separar rol operador del rol admin en verifyAdminSignature | HU-MINOR  | 1 sprint |
| NA-004 | Rate limiting fallback en memoria cuando Upstash cae     | HU-MINOR  | 1 sprint |
| NA-005 | Autenticación en endpoints `/api/v1/agents-internal/*`   | FAST-FIX  | 3h |

### 🟢 Baja prioridad (hardening)

| ID     | Título                                                    | Tipo      | Esfuerzo |
|--------|-----------------------------------------------------------|-----------|----------|
| NA-006 | Limitar columnas en `creator_profiles` public read       | HU-MINOR  | 1 sprint |
| NA-008 | Corregir divide-before-multiply en test file             | FAST-FIX  | 30min |
| NA-011 | Refactorizar `onlyOperator` modifier (code size)         | FAST-FIX  | 30min |
| NA-010 | Separar NEXT_PUBLIC_ owner address del check server-side | FAST-FIX  | 1h |

---

## STRIDE Threat Model Summary

### WasiAIMarketplace.sol

| Threat Category       | Finding | Mitigado |
|-----------------------|---------|----------|
| **Spoofing**          | Operador falso podría registrar agentes | ✅ `onlyOperator` mapping |
| **Tampering**         | Modificar earnings de otro creator | ✅ Pull pattern, solo operator escribe |
| **Repudiation**       | Negar invocación | ✅ `usedPaymentIds` + eventos on-chain |
| **Info Disclosure**   | keyBalances son públicos | ✅ By design (USDC amounts no son secretos) |
| **DoS**               | Batch ilimitado en settleKeyBatch | ✅ Límite de 500 items + daily cap |
| **Elevation of Privilege** | Hot wallet como admin | ⚠️ NA-003 — operador ≠ owner en código, pero sí en verifyAdminSignature |

### WasiEscrow.sol

| Threat Category       | Finding | Mitigado |
|-----------------------|---------|----------|
| **Spoofing**          | Crear escrow falso con escrowId de otro | ✅ `escrows[escrowId].createdAt == 0` guard |
| **Tampering**         | Cambiar payer de escrow | ✅ Immutable en struct |
| **Repudiation**       | Negar liberación | ✅ Eventos EscrowReleased/EscrowRefunded |
| **DoS**               | Bloquear escrow indefinidamente | ✅ `releaseExpired` + `refundExpired` trustless |
| **Race Condition**    | Release vs Refund race after timeout | ⚠️ NA-007 — CEI protege contra reentrancy pero no contra race entre llamadores |

---

*Reporte generado con metodología NexusAudit v1.0 — Anti-Hallucination Protocol aplicado: todos los findings tienen evidencia de código exacta.*
