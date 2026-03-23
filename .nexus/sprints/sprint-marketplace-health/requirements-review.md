# Requirements Review — Sprint: Marketplace Health & Trust
**Fecha:** 2026-03-23
**Reviewer:** Requirements Reviewer (NexusAgil pipeline)
**Sprint:** sprint-marketplace-health
**Work Items:** WAS-276 a WAS-284

---

## WAS-276 — Bloquear dominios de desarrollo en endpoint_url

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Missing scope | ALTA | El AC de "actualizar endpoint de agente existente" no menciona qué ruta lo implementa. No existe `PATCH /agents/:slug/endpoint` en los archivos listados — el status/route.ts no toca `endpoint_url`. ¿Dónde vive esta lógica? | Agregar a Archivos afectados el route que gestiona actualizaciones de endpoint, o aclarar que no existe y debe crearse |
| 2 | Missing edge case | MEDIA | No hay AC para dominios con mayúsculas (p.ej. `LOCA.LT`). La validación síncrona debe ser case-insensitive. | WHEN el dominio tunnel se escribe en mayúsculas o mixto THEN el bloqueo aplica igual |
| 3 | Already implemented (parcial) | INFO | `validateEndpointUrlAsync` ya es llamado en `register/route.ts` y en `callUpstream`. Agregar la blocklist en `validateEndpointUrl.ts` propaga el bloqueo automáticamente a todos los call sites — es correcto. No requiere cambio de contrato en rutas. |
| 4 | Missing edge case | BAJA | No hay AC para puertos no estándar de túneles (p.ej. `https://mi-server.loca.lt:4000`). El matching por hostname cubre esto, pero conviene explicitarlo. | WHEN el dominio tunnel incluye puerto no estándar THEN el bloqueo aplica igualmente |

### ACs sugeridos (agregar)
- WHEN el sistema valida `endpoint_url` en actualización THEN aplica la misma lista de tunnel-domains que en registro (especificar la ruta que hace el update)
- WHEN el dominio tunnel está en cualquier capitalización THEN es bloqueado

### Veredicto
**NECESITA CAMBIOS** — El AC del update de endpoint es invocable sin saber qué ruta lo implementa. Debe identificarse la ruta o indicar que es out-of-scope de este WI.

---

## WAS-277 — Health check automático al activar un agente

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Contradicción con código existente | BLOQUEANTE | AC dice "IF probe falla THEN agente queda en `reviewing`". Pero `health-probe.ts` mapea 5xx → `draft` y timeout/connection_error → `draft`. El WI exige cambiar el comportamiento del probe existente o sobrescribir el status después. Ambas opciones afectan WAS-278 (cron que reutiliza la misma lógica). | Aclarar: ¿se modifica `ProbeStatus` en health-probe.ts para eliminar `draft` de los casos de fallo? ¿O se wrappea la llamada en status/route.ts para forzar `reviewing` si el probe devuelve `draft`? |
| 2 | Ambigüedad sincrónico vs. fire-and-forget | BLOQUEANTE | AC dice "se ejecuta `probeEndpoint()` **antes de confirmar** el cambio" — implica awaited/sincrónico. Pero `probeEndpoint()` tiene un timeout de 5s y hace I/O de red. Si se bloquea la request del creador, el endpoint puede tardar hasta 5s en responder. No hay AC de timeout desde la perspectiva del usuario (¿cuánto espera el creador?). | Agregar AC: WHEN el probe tarda más de X segundos THEN la activación falla con timeout claro. O redefinir como fire-and-forget y ajustar el AC para reflejar respuesta asíncrona. |
| 3 | Already implemented (parcial) | INFO | `register/route.ts` YA llama `probeEndpoint()` para `authMethod !== 'jwt'` en modo fire-and-forget. El WI pide comportamiento sincrónico (pre-confirmar). Hay una inconsistencia de diseño entre ambas rutas — conviene uniformizar. |
| 4 | Missing edge case | ALTA | No hay AC para el caso en que el agente no tiene `endpoint_url` al intentar activarse. ¿Se bloquea la activación? ¿Se deja en `draft`? | WHEN un agente sin `endpoint_url` intenta pasar a `active` THEN el sistema rechaza con 422 "endpoint_url is required to activate" |
| 5 | Missing dependency | MEDIA | El WI depende de WAS-276 (tunnel block) pero el probe también usa `validateEndpointUrlAsync`. Si WAS-276 no está listo, el probe podría intentar conectar a un tunnel antes del bloqueo. La dependencia está marcada en la tabla de prioridades pero no en el WI en sí. | Agregar nota explícita: WAS-276 debe estar merged antes de mergear WAS-277 |

### ACs sugeridos (agregar)
- WHEN el agente no tiene `endpoint_url` al activar THEN el sistema rechaza con 422
- WHEN el probe está corriendo síncronamente THEN la activación tiene un timeout máximo de N segundos visible en la respuesta de error

### Veredicto
**BLOQUEANTE** — Contradicción directa entre los ACs del WI y el comportamiento actual de `health-probe.ts` (draft vs reviewing en fallos). Debe resolverse antes de implementar.

---

## WAS-278 — Cron de health check periódico para agentes activos

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Missing schema change | BLOQUEANTE | AC: "si falla 3 veces consecutivas → degraded". Para contar fallos consecutivos se necesita una columna (`consecutive_failures INT DEFAULT 0` o similar). No hay migration SQL en archivos afectados. El WI no menciona este cambio de schema. | Agregar Migration SQL a los Archivos afectados y AC: WHEN el cron actualiza el health THEN persiste el contador de fallos consecutivos en DB |
| 2 | Type conflict | ALTA | `ProbeStatus` en `health-probe.ts` solo acepta `'active' \| 'reviewing' \| 'draft'`. El valor `'degraded'` mencionado en el AC no existe. El WI dice "nuevo valor o usando `reviewing`" pero no decide. Esta ambigüedad bloquea la implementación. | Decidir: ¿se agrega `'degraded'` al enum ProbeStatus y a la columna `status` en DB (con migration), o se usa `reviewing`? Especificar en el WI. |
| 3 | Ambigüedad en frecuencia | ALTA | No hay AC que especifique con qué frecuencia corre el cron. `vercel.json` tiene crons con schedules explícitos. El WI no dice si es cada 5min, 15min, 1h. | Agregar: WHEN se agrega el cron a vercel.json THEN el schedule es `*/15 * * * *` (o el valor decidido). Sin esto el desarrollador elige arbitrariamente. |
| 4 | Conflicto lógico con probeEndpoint existente | ALTA | `probeEndpoint()` ya actualiza `status` directamente a `'active'` / `'reviewing'` / `'draft'` en cada llamada. Si el cron reutiliza esta función, NO puede implementar la lógica de "3 fallos consecutivos" porque `probeEndpoint` sobreescribe el status en cada invocación sin considerar el historial. El WI dice "reusar lógica existente" pero eso no es compatible con el comportamiento acumulativo requerido. | Aclarar si se extiende `probeEndpoint` para recibir el contador actual, o si el cron implementa su propia lógica de update con conteo independiente. |
| 5 | Missing edge case | MEDIA | No hay AC para el caso en que el cron encuentra 0 agentes activos (DB vacía, todos degradados). ¿El cron termina silenciosamente o registra un log? |
| 6 | Missing edge case | MEDIA | No hay AC para agentes con `endpoint_url = null` que por alguna razón tienen `status: active` (el WAS-280 podría dejar algunos en este estado). ¿El cron los salta? ¿Los degrada? | WHEN un agente activo no tiene `endpoint_url` THEN el cron lo marca como `reviewing` y actualiza `health_check` con reason `no_endpoint` |
| 7 | Reactivación automática sin gate | BAJA | "WHEN el agente vuelve a responder OK THEN status regresa a active automáticamente" — esto bypassa el gate de onboarding (WAS-279) y el de creator_id (WAS-280). Un agente con creator_id=null podría reactivarse automáticamente. | Agregar AC: WHEN el cron intenta reactivar un agente THEN verifica que pase los gates de WAS-279 y WAS-280 antes de cambiar a active |

### ACs sugeridos (agregar)
- WHEN el cron corre THEN usa schedule `<valor explícito>` definido en vercel.json
- WHEN el agente lleva N fallos consecutivos (campo `consecutive_failures` en DB) THEN cambia a degraded
- WHEN un agente activo no tiene endpoint_url THEN el cron lo pasa a reviewing con reason `no_endpoint`
- Migration SQL para columna `consecutive_failures` y enum `degraded`

### Veredicto
**BLOQUEANTE** — Falta schema de DB (consecutive_failures), tipo 'degraded' no definido, frecuencia del cron no especificada, y conflicto lógico con probeEndpoint existente. No se puede implementar con la información actual.

---

## WAS-279 — Gate: onboarding completo antes de publicar agente

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Ambigüedad en condición del gate | ALTA | El AC dice "`onboarding_completed: false`" pero el contexto dice "al menos wallet configurada". ¿El gate verifica el boolean `onboarding_completed` O verifica que `wallet_address IS NOT NULL`? Si un creador tiene `onboarding_completed: true` pero sin wallet, ¿puede publicar? | Aclarar: WHEN el creador intenta activar un agente AND `creator_profiles.wallet_address IS NULL` THEN rechazar. O definir explícitamente que el gate usa solo el booleano. |
| 2 | Contradicción con WAS-280 | MEDIA | WAS-280 AC3 dice "agentes sin creator_id" → gate no aplica. Pero WAS-280 AC2 dice que activar un agente sin `creator_id` debe rechazarse con 422. Si ambos WIs se implementan, ¿cuál tiene precedencia? La regla de WAS-279 ("sin creator_id → gate no aplica") contradice WAS-280. | Reconciliar: definir el orden de validaciones en la ruta de activación. WAS-280 debería correr ANTES que WAS-279 — si no hay creator_id, rechazar por WAS-280, no saltar el gate. |
| 3 | Missing retroactive behavior | MEDIA | Los 4 creadores con `onboarding_completed: false` y agentes activos ya existen. El WI no especifica si se aplica retroactivamente. | Agregar AC: WHEN se despliega este cambio THEN los agentes activos de creadores con onboarding incompleto se pasan a `reviewing` (o se documentan como fuera de scope). |
| 4 | Missing edge case | MEDIA | No hay AC para el path de `register/route.ts` con `authMethod === 'jwt'` que activa directamente (`status: 'active'`). El gate debe aplicar también ahí. | WHEN un developer con JWT hace POST /api/v1/agents/register AND su onboarding está incompleto THEN el agente se crea en `reviewing` en lugar de `active` |
| 5 | "Agente interno" sin definición | BAJA | "Agente de tipo interno (sin creator_id)" — el término "interno" no está definido en ningún lugar del codebase. ¿Es un `agent_type`? ¿Un flag? ¿Solo significa `creator_id IS NULL`? | Reemplazar con "WHEN creator_id IS NULL" para ser preciso |

### ACs sugeridos (agregar)
- WHEN creator_profiles.wallet_address IS NULL (o `onboarding_completed: false`, definir cuál) AND status → active vía JWT THEN agente se crea en `reviewing`
- Definir comportamiento retroactivo para agentes ya activos

### Veredicto
**NECESITA CAMBIOS** — Ambigüedad en la condición del gate (boolean vs wallet), contradicción con WAS-280, y falta el caso JWT de register/route.ts.

---

## WAS-280 — Integridad: creator_id NOT NULL en agentes activos

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Missing blockchain concern | BLOQUEANTE | AC1: "90% va a un wallet de treasury definido". El settlement es manejado por el smart contract que "splits 90/10 internally". Si el agente no está registrado on-chain con un `creator_wallet`, el contrato ya tiene su propia lógica de fallback (o revierte). El WI asume que el fallback a treasury es implementable en el invoke route, pero el contrato es el que distribuye — la ruta no puede redirigir un pago que ya fue settleado on-chain. Esto requiere coordinación con el contrato o documentar que solo aplica al path de Agent Key (off-chain accounting). | Separar: AC para path x402 (settlement on-chain, coordinar con contrato) vs. path agent-key (off-chain, incrementar treasury earnings en lugar de creator). |
| 2 | Missing migration spec | ALTA | "Migration SQL" está en archivos afectados pero sin ningún AC que lo especifique. ¿Es un NOT NULL constraint? ¿Un CHECK? ¿Una migration de datos primero? Aplicar NOT NULL directamente rompe la DB si hay filas existentes con null. | Agregar AC: WHEN se aplica la migration THEN primero se actualizan los registros existentes (assign creator o mark for review), THEN se agrega el constraint |
| 3 | Missing AC para creator con wallet nulo | MEDIA | Un agente puede tener `creator_id` válido pero el creator sin `wallet_address`. El settlement falla igual. WAS-280 solo bloquea `creator_id IS NULL` pero no `creator_profiles.wallet_address IS NULL`. | Agregar AC: WHEN un agente se activa y su creator no tiene wallet_address THEN el agente queda en reviewing con mensaje claro |
| 4 | Data fix no especificado | MEDIA | AC3 menciona "gatesolve-captcha (y cualquier agente existente)" pero es un fix de datos, no de código. No hay AC con las acciones de la migration de datos (¿qué creator se asigna? ¿se usa WASIAI_SYSTEM_CREATOR_ID?). | Agregar AC o tarea separada: identificar todos los agentes activos con creator_id=null, asignar system creator o marcar como reviewing antes del constraint |
| 5 | Already partially implemented | INFO | `invoke/route.ts` ya guarda `triggerAgentEvent` solo si `model.creator_id` existe. El `increment_pending_earnings` también está guarded. El 90% del pago al creador ya es "silencioso" si creator_id es null — el dinero no se pierde en sentido estricto (el contrato lo maneja), pero los earnings off-chain sí se pierden. |

### ACs sugeridos (agregar)
- WHEN path es agent-key y creator_id es null THEN `increment_pending_earnings` llama al treasury account en lugar de creator
- WHEN path es x402 y creator_id es null THEN registrar en `settlement_failures` con reason `no_creator`
- Migration debe ser en dos pasos: data fix primero, constraint después

### Veredicto
**BLOQUEANTE** — El AC1 (treasury fallback) es inconsistente con cómo funciona el settlement on-chain. No se puede implementar en la invoke route sin coordinación con el smart contract.

---

## WAS-281 — Mensaje 429 mutex más claro

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Already implemented (parcial) | INFO | El `Retry-After: 5` ya está presente. El WI agrega `retry_after_seconds: 5` al body — correcto. El AC es minimal y claro. |
| 2 | Missing path | BAJA | El path de Redis unavailable también devuelve 503 con `Retry-After: 5` pero sin `retry_after_seconds` en el body. ¿Se estandariza también ese mensaje? El WI no lo menciona. | Agregar AC o nota: WHEN Redis falla THEN el 503 también incluye `retry_after_seconds` |

### ACs sugeridos (agregar)
- (Opcional) WHEN Redis unavailable y se retorna 503 THEN body incluye `retry_after_seconds: 5` para consistencia

### Veredicto
**PASS** — Work Item es preciso, testeable, y el scope es correcto. La observación de consistencia en el 503 es opcional.

---

## WAS-282 — Detección de cuentas multi-alias (spam/bot)

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Missing schema change | ALTA | "Nueva columna o campo en `creator_profiles`" está en archivos afectados sin especificar. ¿Es un status enum? ¿Un booleano `is_pending_review`? ¿Un campo en la tabla de auth? Sin esto el AC "la cuenta queda en `pending_review`" no es implementable. | Especificar: agregar columna `account_status ENUM('active', 'pending_review', 'suspended') DEFAULT 'active'` a `creator_profiles` o el equivalente. |
| 2 | Ambigüedad en threshold | MEDIA | ">2 cuentas" — ¿>2 significa 3 o más, o >=2 (2 o más)? El contexto dice "registró 3 cuentas" pero el AC usa >2. Aclarar para que el assert sea unambiguo. | Reescribir: "WHEN el dominio ya está presente en 3 o más cuentas existentes..." |
| 3 | Missing retroactive behavior | MEDIA | `oldlanguage75@agentmail.to` y sus aliases ya existen. ¿El gate se aplica retroactivamente o solo a nuevos registros? | Agregar AC o scope out: WHEN se despliega WAS-282 THEN cuentas existentes con >2 aliases quedan como están (no retroactivo) — requiere decisión explícita del PO |
| 4 | Missing race condition | MEDIA | Si dos cuentas del mismo dominio se registran simultáneamente, ambas ven el conteo en 1 y ninguna se bloquea. | Agregar AC: WHEN dos registros del mismo dominio ocurren concurrentemente THEN al menos uno queda en `pending_review` (implementar con DB unique/serializable) |
| 5 | Allowlist de proveedores masivos | BAJA | "gmail, hotmail, outlook, etc." — ¿quién mantiene esta lista? ¿Está hardcodeada? ¿Hay proceso para actualizarla? | Aclarar en scope: la lista de proveedores masivos es una constante interna del servicio, gestionada por el equipo de seguridad |
| 6 | Missing route file | BAJA | `src/app/api/v1/auth/agent-signup/route.ts` no aparece en los archivos de contexto — no se puede verificar si existe. Si no existe, el WI está apuntando a un archivo que no hay que editar sino crear. | Verificar existencia del archivo antes de cerrar el WI |

### ACs sugeridos (agregar)
- Especificar nombre y tipo de columna en `creator_profiles` para `pending_review`
- WHEN el dominio ya tiene 3 o más cuentas THEN (no ">2" ambiguo)

### Veredicto
**NECESITA CAMBIOS** — Schema no especificado, threshold ambiguo, comportamiento retroactivo sin decisión.

---

## WAS-283 — Badge de salud de endpoint en marketplace UI

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Missing i18n | ALTA | La ruta es `[locale]/(public)/marketplace/` — el badge "✅ Online", "⚠️ Degraded", "❌ Down", "— Not checked" debe estar en el sistema de traducciones. El WI no menciona i18n. Si el texto es hardcoded en inglés, rompe la UX para usuarios en español u otros locales. | Agregar AC: WHEN el locale es no-inglés THEN los textos del badge usan las traducciones del sistema i18n del proyecto |
| 2 | Missing refresh strategy | ALTA | No hay AC de cómo y cuándo se actualiza el badge. ¿Server-Side Rendered (snapshot estático)? ¿Polling cada N segundos? ¿WebSocket? Con el cron de WAS-278 actualizando `last_checked_at`, el badge puede estar desactualizado por minutos. | Agregar AC: WHEN el usuario carga el marketplace THEN los badges reflejan el estado del último cron (SSR, sin polling client-side — decisión debe ser explícita) |
| 3 | Ambigüedad en display de performance_score | MEDIA | "se muestra junto al badge" — ¿en qué formato? ¿0-100? ¿latencia en ms? ¿porcentaje de uptime? `health-probe.ts` no escribe `performance_score` — ese campo no es actualizado por el probe actual. ¿Quién lo actualiza? | Aclarar formato de `performance_score` y qué ruta/cron lo actualiza (no es health-probe.ts actual) |
| 4 | Missing loading/skeleton state | BAJA | No hay AC para el estado de carga inicial de los badges. | WHEN el marketplace está cargando THEN los badges muestran skeleton state (o se omite explícitamente como out-of-scope) |
| 5 | Missing accessibility | BAJA | Los emojis de badge (✅ ⚠️ ❌) sin aria-labels son inaccesibles para screen readers. | WHEN el badge se renderiza THEN tiene `aria-label` con el texto del estado |
| 6 | Dependency sin resolver | INFO | WAS-283 depende de WAS-278 (cron que actualiza los campos). Si WAS-278 tiene los BLOQUEANTEs identificados, el badge mostrará siempre "— Not checked". Debe resolverse WAS-278 antes. |

### ACs sugeridos (agregar)
- WHEN el locale no es 'en' THEN los textos del badge usan el sistema de traducciones
- Definir estrategia de refresh (SSR vs polling) con AC concreto
- Aclarar formato y fuente de `performance_score`

### Veredicto
**NECESITA CAMBIOS** — i18n faltante es crítico dado el sistema de locales en la ruta. Estrategia de refresh sin definir. `performance_score` referencia campo que no es actualizado por el código existente.

---

## WAS-284 — Upstream errors propagan HTTP status correcto

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Missing budget interaction (Route A) | BLOQUEANTE | Para el path de Agent Key: el budget se deduce DESPUÉS de `callUpstream` (línea `check_and_deduct_budget`). Si el upstream devuelve 4xx→502, ¿se cobra al budget? El WI dice `refunded: true` si `charged = 0`, pero el código actual ya tiene `charged: 0` cuando `status === 'error'` — no hay deducción. Sin embargo, esto NO es explícito en el WI y debe serlo. | Agregar AC: WHEN upstream devuelve 4xx o 5xx via agent-key THEN el budget NO se deduce y `meta.charged = 0` |
| 2 | Semántica incorrecta de "refunded" en x402 | ALTA | Para Route B (x402), el dinero ya está settleado on-chain ANTES de llamar al upstream. Si el upstream devuelve 4xx→502, `refunded: true` en el meta es FALSO — no hay refund real. Esto engaña al cliente. El registro de `settlement_failures` ya existe para esto. | Reemplazar AC: WHEN upstream falla en x402 path THEN `meta.charged = 0` NO aplica (ya se cobró). En su lugar: `meta.settlement_failed: true` y referencia al sistema de resolución manual. O eliminar `refunded: true` del x402 path. |
| 3 | Missing circuit breaker interaction | MEDIA | El circuit breaker (`wrapWithCircuitBreaker`) cuenta fallos basándose en exceptions. Si `callUpstream` devuelve `{ status: 'error' }` (para 4xx, sin exception), el CB no cuenta el fallo. Con el nuevo mapeo a 502, ¿el CB ahora contará estos como fallos? Hay una interacción no documentada. | Agregar AC o nota en scope: los cambios de HTTP status en la respuesta de WasiAI NO afectan la lógica del circuit breaker (que opera internamente sobre el comportamiento del upstream) |
| 4 | Missing edge case para response body 4xx | MEDIA | Cuando upstream devuelve 4xx, `callUpstream` retorna `{ error: \`Upstream ${upstream.status}\` }`. El WI dice "con el body de error actual" — pero el body actual ya pierde el cuerpo real del upstream (solo captura el status code). ¿Debe pasarse el body del upstream en el 502? | Aclarar: WHEN upstream devuelve 4xx THEN el 502 incluye el body upstream o solo el código de error WasiAI (decisión explícita) |
| 5 | buildResponse no acepta status | INFO | La función `buildResponse` siempre retorna `NextResponse.json(...)` sin status code explícito (default 200). Para implementar este WI se necesita modificar la firma de `buildResponse` o crear una variante. No está en los archivos afectados. | El WI debería mencionar que `buildResponse` necesita refactorización para aceptar HTTP status como parámetro |

### ACs sugeridos (agregar)
- WHEN path es x402 y upstream falla THEN NO incluir `refunded: true` (el dinero ya se settleó on-chain)
- WHEN path es agent-key y upstream falla THEN budget NO se deduce y `meta.charged = 0`
- Aclarar el impacto (o no-impacto) en el circuit breaker

### Veredicto
**NECESITA CAMBIOS** — El AC de `refunded: true` es semánticamente incorrecto para el path x402. La interacción con el settlement on-chain debe aclararse.

---

## Hallazgos ordenados por severidad

### 🔴 BLOQUEANTE

| # | WI | Hallazgo |
|---|-----|---------|
| B1 | WAS-277 | Contradicción directa: ACs dicen `reviewing` en fallos, `health-probe.ts` usa `draft` para 5xx/timeout |
| B2 | WAS-277 | Ambigüedad bloqueante: ¿sincrónico (bloquea request) o fire-and-forget? Impacta UX y timeout |
| B3 | WAS-278 | Falta columna DB `consecutive_failures` — no hay migration, sin esto el cron no puede implementarse |
| B4 | WAS-278 | `'degraded'` no existe en `ProbeStatus` ni en DB enum — requiere migration de schema no especificada |
| B5 | WAS-278 | Conflicto lógico: `probeEndpoint()` existente sobreescribe status en cada llamada, incompatible con "3 fallos consecutivos" |
| B6 | WAS-280 | Treasury fallback en x402 es implementado en invoke route pero el settlement ya ocurrió on-chain — el contrato controla la distribución, no la ruta |

### 🟠 ALTA

| # | WI | Hallazgo |
|---|-----|---------|
| A1 | WAS-276 | AC de "update endpoint" sin ruta identificada — no existe PATCH que actualice endpoint_url |
| A2 | WAS-278 | Frecuencia del cron no especificada — desarrollador elige arbitrariamente |
| A3 | WAS-279 | Gate condition ambigua: `onboarding_completed` boolean vs `wallet_address IS NOT NULL` |
| A4 | WAS-279 | JWT path en register/route.ts no cubierto por el gate (activa directamente) |
| A5 | WAS-280 | Migration SQL sin spec — NOT NULL en columna con nulls existentes requiere 2-phase migration |
| A6 | WAS-282 | Schema de `pending_review` no especificado — columna, tipo, y valores no definidos |
| A7 | WAS-283 | i18n faltante — ruta tiene `[locale]` y textos del badge están hardcoded en inglés |
| A8 | WAS-283 | Estrategia de refresh del badge no definida (SSR vs polling) |
| A9 | WAS-284 | `refunded: true` semánticamente incorrecto para path x402 (settlement ya on-chain) |

### 🟡 MEDIA

| # | WI | Hallazgo |
|---|-----|---------|
| M1 | WAS-277 | Missing AC: agente sin `endpoint_url` intentando activarse |
| M2 | WAS-278 | Reactivación automática bypassa gates de WAS-279 y WAS-280 |
| M3 | WAS-279 | Contradicción entre WAS-279 (sin creator_id → gate no aplica) y WAS-280 (sin creator_id → rechazar) |
| M4 | WAS-279 | Comportamiento retroactivo para agentes activos de creadores con onboarding incompleto no definido |
| M5 | WAS-280 | Creator con `creator_id` válido pero sin `wallet_address` no está cubierto |
| M6 | WAS-280 | Data fix de gatesolve-captcha y otros agentes con creator_id=null no tiene AC de migration de datos |
| M7 | WAS-282 | Threshold ">2" es ambiguo — ¿2 o más? ¿3 o más? |
| M8 | WAS-282 | Race condition en registro simultáneo del mismo dominio |
| M9 | WAS-283 | `performance_score` no es actualizado por health-probe.ts actual — fuente de datos no identificada |
| M10 | WAS-284 | Circuit breaker interaction con los nuevos HTTP status codes no documentada |
| M11 | WAS-284 | Body del upstream en 4xx no especificado si se pasa al caller o se descarta |

### 🟢 BAJA / INFO

| # | WI | Hallazgo |
|---|-----|---------|
| L1 | WAS-276 | Dominios tunnel con mayúsculas no cubiertos explícitamente |
| L2 | WAS-277 | register/route.ts ya implementa probe fire-and-forget (parcialmente implementado) — inconsistencia de diseño con el nuevo AC sincrónico |
| L3 | WAS-281 | 503 Redis-unavailable no tiene `retry_after_seconds` para consistencia |
| L4 | WAS-282 | Allowlist de proveedores masivos sin proceso de mantenimiento definido |
| L5 | WAS-282 | `agent-signup/route.ts` puede no existir — verificar antes de cerrar |
| L6 | WAS-283 | Falta skeleton state y aria-labels en badges |
| L7 | WAS-284 | `buildResponse` necesita refactorización de firma para aceptar HTTP status — no mencionado |

---

## Resumen ejecutivo

| WI | Veredicto | Razón |
|----|-----------|-------|
| WAS-276 | NEEDS_REVISION | Ruta de update de endpoint no identificada |
| WAS-277 | **BLOQUEANTE** | Contradicción sync/async + conflict con ProbeStatus existente |
| WAS-278 | **BLOQUEANTE** | Schema DB missing, type conflict, frecuencia sin definir, conflicto lógico con probeEndpoint |
| WAS-279 | NEEDS_REVISION | Gate condition ambigua, JWT path no cubierto |
| WAS-280 | **BLOQUEANTE** | Treasury fallback en x402 no es implementable en la invoke route |
| WAS-281 | PASS | WI correcto y minimal |
| WAS-282 | NEEDS_REVISION | Schema no especificado, threshold ambiguo |
| WAS-283 | NEEDS_REVISION | i18n crítico, refresh strategy indefinida |
| WAS-284 | NEEDS_REVISION | `refunded: true` incorrecto para x402 |

**3 BLOQUEANTEs** (WAS-277, WAS-278, WAS-280) deben resolverse antes de que cualquier implementación comience.
El único PASS es WAS-281.

---

REQUIREMENTS REVIEW COMPLETE

**Resumen:** 9 WIs revisados. 1 PASS, 5 NEEDS_REVISION, 3 BLOQUEANTE. Los BLOQUEANTEs involucran conflictos con código existente (health-probe.ts ProbeStatus), schema de DB incompleto (consecutive_failures, degraded enum), y una asunción incorrecta sobre la capacidad de la invoke route para redirigir payments on-chain ya settlados. Recomendación: no mover ningún WI a HU_APPROVED hasta que los BLOQUEANTEs sean resueltos por el PO con decisiones documentadas en los WIs.
