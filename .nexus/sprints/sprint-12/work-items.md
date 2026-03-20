# Sprint 12 — Work Items (v2 post Requirements Review)

---

## WAS-232 — Wizard de onboarding conversacional para creators (agentes y humanos)

**Clasificación:** HU-MAJOR
**Prioridad:** P1
**Versión:** v2 (post requirements review 2026-03-17)

### Historia de Usuario
Como agente o builder que quiere monetizar un servicio, quiero poder registrarme en WasiAI respondiendo preguntas simples (sin documentación ni curl commands), para que mi agente quede live y earning en menos de 5 minutos.

### Decisiones de arquitectura
- El wizard es una capa de orquestación — **reutiliza** `agent-signup` + `agents/register` internamente, no duplica lógica
- Sesión persiste en tabla `onboarding_sessions` con TTL de 30 minutos
- Schema `onboarding_sessions`: `(id UUID PK, ip TEXT, status ENUM(active|completed|expired), current_step INT, data JSONB, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)`
- Pasos del wizard (orden fijo): 1-name, 2-description, 3-endpoint_url, 4-category, 5-price, 6-tags(opcional), 7-email

### Acceptance Criteria (EARS)

**Happy path:**
1. WHEN un agente llama `POST /api/v1/onboard/start` THEN THE sistema SHALL retornar `{ session_id, step: 1, question: "What is your agent's name?" }`
2. WHEN el agente llama `POST /api/v1/onboard/step` con `{ session_id, answer }` válidos THEN THE sistema SHALL persistir la respuesta, avanzar al siguiente step y retornar `{ step: N, question: "..." }` o `{ completed: true, agent_key, agent_url, slug }` si es el último step
3. WHEN el agente proporciona su `endpoint_url` (step 3) THEN THE sistema SHALL hacer ping automático via `probeEndpoint()` y retornar el resultado en la respuesta del step
4. WHEN todos los pasos están completos THEN THE sistema SHALL llamar internamente a `agent-signup` + `agents/register`, marcar la sesión como `completed` y retornar `{ agent_key, agent_url, slug }` — el `agent_key` se muestra UNA sola vez

**Error paths:**
5. IF el endpoint no responde al ping en 5 segundos THEN THE sistema SHALL retornar `{ error: "endpoint_unreachable" }` con HTTP 200 y permitir reintentar (no avanzar el step)
6. IF el endpoint responde con status non-2xx THEN THE sistema SHALL retornar `{ error: "endpoint_unhealthy", status: <código> }` y permitir reintentar
7. IF el email proporcionado ya está registrado en `creator_profiles` THEN THE sistema SHALL retornar `{ error: "email_already_registered" }` con HTTP 409
8. IF `POST /api/v1/onboard/step` recibe `answer` vacío o null THEN THE sistema SHALL retornar HTTP 400 con `{ error: "answer_required" }`
9. IF se llama `POST /api/v1/onboard/step` con `session_id` inválido o expirado THEN THE sistema SHALL retornar HTTP 404
10. IF se llama `POST /api/v1/onboard/step` sobre una sesión en estado `completed` THEN THE sistema SHALL retornar HTTP 409 con `{ error: "session_completed" }`

**Estado y expiración:**
11. WHEN se llama `GET /api/v1/onboard/:session_id` THEN THE sistema SHALL retornar el estado actual `{ current_step, status, completed_fields }` o HTTP 404 si no existe
12. WHEN una sesión supera 30 minutos sin actividad THEN THE sistema SHALL marcarla como `expired` (via DB TTL o check en cada request)

**Rate limiting:**
13. IF se llama `POST /api/v1/onboard/start` más de 5 veces desde la misma IP en 1 hora THEN THE sistema SHALL retornar HTTP 429 usando el patrón `checkRateLimit()` existente

**JSON Schema inference (opcional):**
14. IF el agente envía `answer: "skip"` en el step de `input_schema` THEN THE sistema SHALL hacer una llamada de prueba al endpoint con `{}` e inferir la estructura del response como `output_schema`

### Scope IN
- `POST /api/v1/onboard/start`
- `POST /api/v1/onboard/step`
- `GET /api/v1/onboard/:session_id`
- Migración DB: tabla `onboarding_sessions`
- Reutiliza: `probeEndpoint()`, `generateApiKey()`, lógica de `agent-signup` y `agents/register`

### Scope OUT
- UI visual del wizard (frontend)
- Wizard vía Discord/Moltbook DM
- Edición post-registro vía wizard
- Cleanup job para sesiones expiradas (puede ser cron separado)

---

## WAS-225 — Transaction History: historial de calls, settlements y retiros

**Clasificación:** HU-MAJOR
**Prioridad:** P2
**Versión:** v2 (post requirements review 2026-03-17)

### Historia de Usuario
Como creator, quiero ver un historial de mis transacciones (calls recibidas, settlements on-chain, retiros) para entender cuándo y cómo se generaron mis ganancias.

### Decisiones de arquitectura
- Fuente de datos: `key_batch_settlements` (settlements), `agent_calls` agrupadas por batch (calls), `creator_withdrawal_vouchers` (retiros — tabla existente)
- Paginación: 20 items por página con cursor
- Endpoint en `/api/creator/transactions` (ruta protegida, requiere JWT como otras rutas de `/api/creator/`)
- WAS-190 es dependencia declarada: los tx_hash links usan `explorerTx()` de `@/lib/chain`

### Acceptance Criteria (EARS)

**Autenticación:**
1. THE endpoint `GET /api/creator/transactions` SHALL requerir JWT válido; IF el token está ausente o es inválido THEN SHALL retornar HTTP 401

**Happy path — datos:**
2. WHEN el creator llama `GET /api/creator/transactions` THEN THE sistema SHALL retornar las transacciones paginadas de 20 en 20 con `{ data: [...], total: N, page: N, per_page: 20 }`
3. WHEN hay settlements en `key_batch_settlements` THEN cada item SHALL incluir: `{ type: "settlement", date, call_count, total_usdc, tx_hash }`
4. WHEN hay retiros en `creator_withdrawal_vouchers` THEN cada item SHALL incluir: `{ type: "withdrawal", date, amount_usdc, tx_hash }`
5. WHEN hay calls recibidas THEN cada item SHALL incluir: `{ type: "call", date, agent_slug, amount_usdc, status }`

**UI en dashboard:**
6. WHEN el creator visita su dashboard THEN THE sistema SHALL mostrar una sección "Transaction History" que consume `GET /api/creator/transactions`
7. WHEN no hay transacciones THEN THE sistema SHALL mostrar estado vacío con texto: "No transactions yet. Your settlements and withdrawals will appear here."
8. IF el creator no tiene wallet conectada THEN THE sistema SHALL mostrar solo transacciones de tipo `call`, ocultando `settlement` y `withdrawal`

**Paginación:**
9. WHEN el creator solicita una página fuera del rango disponible THEN THE sistema SHALL retornar HTTP 200 con `{ data: [], total: N, page: N, per_page: 20 }`

**Acceso no autorizado:**
10. IF un usuario no-creator intenta acceder al endpoint THEN THE sistema SHALL retornar HTTP 403

### Scope IN
- `GET /api/creator/transactions` (nuevo endpoint)
- Componente `TransactionHistory` en creator dashboard
- Datos de: `key_batch_settlements`, `agent_calls`, `creator_withdrawal_vouchers`

### Scope OUT
- Filtros por fecha o tipo
- Export CSV
- Notificaciones push
- Tabla `withdrawal_requests` (no existe — usar `creator_withdrawal_vouchers`)

---

## WAS-190 — Earnings con links a Snowtrace

**Clasificación:** HU-MINOR
**Prioridad:** P4
**Dependencia:** WAS-225 (debe implementarse primero)
**Versión:** v2 (post requirements review 2026-03-17)

### Historia de Usuario
Como creator, quiero que cada settlement aparezca con un link directo a Snowtrace para verificar on-chain que el dinero llegó.

### Decisiones de arquitectura
- Usar `explorerTx()` de `@/lib/chain` — ya maneja mainnet vs testnet (IS_FUJI) automáticamente
- Si IS_FUJI no está configurado → `explorerTx()` defaultea a mainnet (comportamiento ya implementado en chain.ts)
- Integrar en el componente `TransactionHistory` de WAS-225

### Acceptance Criteria (EARS)

1. WHEN se renderiza un item de tipo `settlement` o `withdrawal` con `tx_hash` THEN THE sistema SHALL mostrar el hash como link usando `explorerTx(tx_hash)` de `@/lib/chain`
2. WHEN el creator hace click en el link THEN THE sistema SHALL abrir la URL en tab nueva (`target="_blank" rel="noopener noreferrer"`)
3. IF el `tx_hash` es null, vacío o tiene formato inválido (no string hexadecimal de 66 chars) THEN THE sistema SHALL no renderizar el link (sin romper el layout)
4. WHEN IS_FUJI está activo en el entorno THEN `explorerTx()` SHALL retornar URL de testnet (comportamiento heredado del helper existente — no requiere lógica adicional)

### Scope IN
- Integración de `explorerTx()` en `TransactionHistory` (WAS-225)
- Validación de formato de `tx_hash` antes de renderizar

### Scope OUT
- Links a otros explorers (Etherscan, etc.)
- Historial on-chain independiente de la DB
