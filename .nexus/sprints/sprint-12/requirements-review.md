# Requirements Review — Sprint 12
**Reviewer:** Requirements Reviewer (NexusAgile v1.3)
**Date:** 2026-03-17
**WIs revisados:** WAS-232, WAS-225, WAS-190

---

## Requirements Review — WAS-232
> Wizard de onboarding conversacional

### Findings

| # | Tipo | Severidad | Detalle | AC relacionado |
|---|------|-----------|---------|----------------|
| 1 | GAP_FUNCIONAL | 🔴 CRÍTICA | No hay AC para GET /api/v1/onboard/:session_id (está en Scope IN pero sin AC que defina qué retorna, cuándo usarlo, ni qué hacer si el session_id no existe). | Ninguno |
| 2 | GAP_FUNCIONAL | 🔴 CRÍTICA | El flujo de email (AC5) dispara creación de `creator_profile` + `agent_key`, pero NO menciona qué pasa si el email ya existe. ¿Error? ¿Reuse del profile existente? Sin este caso el endpoint es bloqueante en producción. | AC5 |
| 3 | CONFLICTO_CÓDIGO | 🔴 CRÍTICA | AC5 dice "crear `creator_profile` y generar `agent_key`" pero ya existen `POST /api/v1/auth/agent-signup` y `generateApiKey()` para ese propósito. El WI no menciona si el onboarding reutiliza estos servicios o duplica lógica. Riesgo de bifurcación de lógica de negocio. | AC5, AC6 |
| 4 | GAP_MIGRACIÓN_DB | 🔴 CRÍTICA | La tabla `onboarding_sessions` no existe. El WI no incluye especificación de schema (campos, tipos, TTL, índices). Sin esto el ticket no puede estimarse ni implementarse. | General |
| 5 | GAP_FUNCIONAL | 🟠 ALTA | No hay AC para expiración de sesión: ¿cuánto tiempo dura una `onboarding_session`? AC8 menciona "sesión expirada" pero ningún AC define cuándo expira ni qué proceso la marca. | AC8 |
| 6 | GAP_FUNCIONAL | 🟠 ALTA | AC7 no tiene condición de trigger explícita ("WHEN el creator no sabe el JSON Schema" no es un evento de sistema — ¿cómo detecta el sistema que "no sabe"? ¿Es una respuesta específica? ¿Un campo omitido? No es testeable tal como está. | AC7 |
| 7 | GAP_SEGURIDAD | 🟠 ALTA | AC6 retorna `agent_key` en la response final, pero no hay AC que cubra qué pasa si la conexión se cae tras completar el wizard: ¿puede el creator recuperar su `agent_key`? No hay AC para endpoint de recuperación ni para almacenamiento cifrado previo a entrega. | AC6 |
| 8 | GAP_PATHS | 🟠 ALTA | No hay AC para autenticación en `POST /api/v1/onboard/step` — ¿es anónimo (solo por session_id) o requiere token? Si es anónimo, el session_id es el único control de acceso; si alguien adivina un UUID, accede al onboarding ajeno. | General |
| 9 | GAP_FUNCIONAL | 🟡 MEDIA | AC3 y AC4 cubren el ping al endpoint, pero no hay AC para el caso en que el endpoint responde en tiempo pero con status non-2xx. ¿Se considera unreachable? ¿Se permite continuar? | AC3, AC4 |
| 10 | GAP_PATHS | 🟡 MEDIA | No hay AC para step con `answer` vacío/null. AC2 dice "validar la respuesta" pero no define qué respuesta inválida produce (¿400? ¿campo `error`?). No testeable. | AC2 |
| 11 | GAP_PATHS | 🟡 MEDIA | No hay AC que defina qué pasa si el wizard ya está `completed` y se llama de nuevo a `POST /api/v1/onboard/step`. ¿409? ¿Redirección? | General |
| 12 | GAP_SCOPE | 🟡 MEDIA | Scope OUT no menciona qué pasa con sesiones abandonadas (started pero nunca completed). ¿Hay cleanup job? ¿Es parte de este WI o de otro? Riesgo de tabla onboarding_sessions creciendo sin control. | General |
| 13 | CALIDAD_AC | 🟡 MEDIA | AC9 define rate limiting de `POST /api/v1/onboard/start` pero no menciona si aplica el patrón existente `checkRateLimit(getRegisterLimit(), getIdentifier(request))` o si es un nuevo límite con configuración distinta. | AC9 |
| 14 | GAP_FUNCIONAL | 🟡 MEDIA | No hay AC para el orden/secuencia de pasos del wizard. ¿Cuántos pasos hay? ¿El orden es fijo o dinámico? El AC6 asume que hay un estado "todos completos" pero no define cuál es la secuencia completa. | General |

### ACs sugeridos

- **AC-NEW-A:** IF se llama `GET /api/v1/onboard/:session_id` THEN THE sistema SHALL retornar el estado actual de la sesión (paso actual, campos completados, status) o 404 si no existe.
- **AC-NEW-B:** IF el email proporcionado en el wizard ya está registrado en `creator_profiles` THEN THE sistema SHALL retornar `{ "error": "email_already_registered" }` con HTTP 409.
- **AC-NEW-C:** WHEN una `onboarding_session` supera X minutos sin actividad THEN THE sistema SHALL marcarla como `expired` (definir TTL concreto).
- **AC-NEW-D:** IF el creator llama `POST /api/v1/onboard/step` sobre una sesión en estado `completed` THEN THE sistema SHALL retornar HTTP 409.
- **AC-NEW-E:** IF el endpoint responde al ping con status non-2xx THEN THE sistema SHALL retornar `{ "error": "endpoint_unhealthy", "status": <código> }` y permitir reintentar.
- **AC-NEW-F:** IF el campo `answer` llega vacío o null en `POST /api/v1/onboard/step` THEN THE sistema SHALL retornar HTTP 400 con detalle del campo faltante.

### Veredicto: ❌ NECESITA CAMBIOS

---

## Requirements Review — WAS-225
> Transaction History

### Findings

| # | Tipo | Severidad | Detalle | AC relacionado |
|---|------|-----------|---------|----------------|
| 1 | GAP_MIGRACIÓN_DB | 🔴 CRÍTICA | `withdrawal_requests` tiene estado desconocido (tabla puede no existir). Scope IN la incluye como fuente de datos pero ningún AC la referencia explícitamente, y no hay AC que cubra qué mostrar si la tabla no existe o está vacía. | General |
| 2 | GAP_FUNCIONAL | 🔴 CRÍTICA | AC1 dice "últimas 50 transacciones paginadas" — contradicción: si muestra las "últimas 50", la paginación no tiene sentido (solo habría una página). No queda claro si el límite es por página o total. No testeable sin aclaración. | AC1 |
| 3 | GAP_AUTENTICACIÓN | 🔴 CRÍTICA | No hay AC que defina autenticación del endpoint `GET /api/creator/transactions`. ¿Requiere JWT? ¿Qué retorna si el token es inválido o está ausente? Un endpoint de datos financieros sin AC de authn es riesgo de seguridad directo. | AC5 |
| 4 | GAP_FUNCIONAL | 🟠 ALTA | AC5 dice "retornar los datos paginados en JSON" pero no define: estructura del payload, campos por tipo de transacción, página/cursor param, ni límite por página. No implementable sin spec adicional. | AC5 |
| 5 | GAP_PATHS | 🟠 ALTA | No hay AC para acceso no autorizado al dashboard / endpoint. ¿Qué ve un usuario que no es creator? ¿401? ¿Redirect? | General |
| 6 | GAP_PATHS | 🟠 ALTA | AC6 cubre el caso "sin wallet conectada" (solo calls), pero no cubre qué pasa si el creator tiene wallet pero ningún settlement ni call aún (distinto del AC4 que asume "no hay transacciones de ningún tipo"). | AC4, AC6 |
| 7 | CALIDAD_AC | 🟡 MEDIA | AC2 y AC3 dependen de WAS-190 (links a Snowtrace) pero no hay referencia explícita a esa dependencia en el WI. Si WAS-190 no está hecho, ¿estos ACs están bloqueados? | AC2, AC3 |
| 8 | GAP_PATHS | 🟡 MEDIA | No hay AC para paginación: ¿qué pasa si se pide una página que no existe? ¿Retorna array vacío o error? | General |
| 9 | GAP_SCOPE | 🟡 MEDIA | Scope IN incluye `agent_calls` pero ningún AC define explícitamente cómo se muestran las calls recibidas (campos: fecha, agente, monto, status). Solo se menciona implícitamente en AC6. | General |

### ACs sugeridos

- **AC-NEW-A:** THE endpoint `GET /api/creator/transactions` SHALL requerir autenticación válida; IF el token está ausente o es inválido THEN SHALL retornar HTTP 401.
- **AC-NEW-B:** WHEN el creator solicita una página fuera del rango disponible THEN THE sistema SHALL retornar HTTP 200 con array vacío y metadata de paginación (`total`, `page`, `per_page`).
- **AC-NEW-C:** WHEN hay calls recibidas THEN THE sistema SHALL mostrar por cada call: fecha, identificador del agente origen, monto cobrado y status.
- **AC-NEW-D:** Aclarar AC1: definir si 50 es límite por página o total máximo. Proponer redacción: "paginadas de 50 en 50, retornando cursor/page para navegación."

### Veredicto: ❌ NECESITA CAMBIOS

---

## Requirements Review — WAS-190
> Earnings con links a Snowtrace

### Findings

| # | Tipo | Severidad | Detalle | AC relacionado |
|---|------|-----------|---------|----------------|
| 1 | CONFLICTO_CÓDIGO | 🟠 ALTA | `explorerTx()` ya existe como helper de Snowtrace. El WI no menciona que el componente DEBE usar este helper. Si el implementador no lo sabe, puede reimplementar la URL manualmente, creando duplicación o inconsistencia en env handling (IS_FUJI). | General |
| 2 | GAP_FUNCIONAL | 🟠 ALTA | AC1 menciona "o testnet si IS_FUJI" pero no hay AC que defina qué pasa si la variable IS_FUJI no está configurada en el entorno. ¿Default a mainnet? ¿Error silencioso? No está especificado. | AC1 |
| 3 | GAP_PATHS | 🟡 MEDIA | No hay AC para el caso donde `tx_hash` existe pero tiene formato inválido (e.g., string vacío, hash malformado). AC3 solo cubre `tx_hash` ausente/null. | AC3 |
| 4 | DEPENDENCIA_NO_DECLARADA | 🟡 MEDIA | WAS-190 depende de WAS-225 (el componente se integra en Transaction History), pero no hay referencia a esa dependencia en el WI ni indicación de si WAS-190 puede entregarse independientemente. Riesgo de merge conflicts o trabajo en vacío. | General |
| 5 | GAP_SCOPE | 🟡 MEDIA | Scope OUT excluye "links a otros explorers" pero no menciona si el componente debe ser genérico (parametrizable) o hardcodeado a Snowtrace. Si en el futuro se agrega otra chain, el componente puede requerir reescritura. No es blocker para este WI pero debería estar explícito. | General |
| 6 | CALIDAD_AC | 🟢 BAJA | AC2 ("WHEN el creator hace click en el link THEN SHALL abrir en tab nueva") es comportamiento HTML estándar (`target="_blank"`). Es implícito en cualquier link externo — AC trivial que ocupa espacio sin agregar valor de especificación. | AC2 |

### ACs sugeridos

- **AC-NEW-A:** IF `tx_hash` existe pero tiene formato inválido (vacío, longitud incorrecta, caracteres no hex) THEN THE sistema SHALL no mostrar el link (mismo comportamiento que hash ausente).
- **AC-NEW-B:** WHEN se renderiza el link de Snowtrace THEN THE sistema SHALL utilizar el helper `explorerTx()` existente para construir la URL, respetando la variable IS_FUJI.
- **AC-NEW-C:** IF la variable IS_FUJI no está configurada THEN el componente SHALL asumir mainnet por defecto.

### Veredicto: ❌ NECESITA CAMBIOS

---

## Resumen ejecutivo

| WI | Findings 🔴 | Findings 🟠 | Findings 🟡 | Veredicto |
|----|------------|------------|------------|-----------|
| WAS-232 | 4 | 4 | 6 | ❌ NECESITA CAMBIOS |
| WAS-225 | 3 | 3 | 3 | ❌ NECESITA CAMBIOS |
| WAS-190 | 0 | 2 | 4 | ❌ NECESITA CAMBIOS |

**Bloqueantes cross-cutting:**
- `withdrawal_requests` table: estado desconocido. Debe resolverse antes de WAS-225.
- `onboarding_sessions` table: schema no especificado. Bloquea estimación e implementación de WAS-232.
- WAS-190 depende de WAS-225; ambas deben coordinarse para evitar trabajo en vacío.
- WAS-232 conflictúa potencialmente con `POST /api/v1/auth/agent-signup` y `generateApiKey()` — requiere decisión de arquitectura antes de implementar.
