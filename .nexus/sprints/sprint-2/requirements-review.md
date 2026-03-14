# Requirements Review — Sprint 2 WasiAI
_Reviewer: NexusAgile Requirements Bot | Fecha: 2026-03-13_

---

## WAS-196 — Sandbox opt-in/out por agente

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | AC Quality | ALTA | AC-1 no tiene trigger condition. "El campo existe" no es testeable como comportamiento. | AC-1-FIX: WHEN un agente es registrado sin especificar `sandbox_enabled`, THEN el valor SHALL defaultear a `true` |
| 2 | AC Quality | ALTA | AC-3 no especifica QUÉ retorna en el body del 403. Solo dice "retorna 403". | AC-3-FIX: SHALL retornar `{ "error": "sandbox_disabled", "message": "This agent does not accept sandbox invocations" }` |
| 3 | AC Quality | MEDIA | AC-4 no especifica CUÁNDO muestra el mensaje — ¿antes de llamar al endpoint? ¿después de recibir el 403? | AC-4-FIX: WHEN el frontend recibe 403 con `error: sandbox_disabled` THEN SHALL mostrar banner/mensaje antes de permitir reintentar |
| 4 | Cobertura | ALTA | **FALTA error path:** ¿Qué pasa si el agente tiene `sandbox_enabled: false` y ya tiene sesiones de sandbox activas en curso? ¿Se cortan o se terminan? | AC-6 (nuevo): WHEN `sandbox_enabled` cambia de `true` a `false`, las invocaciones en curso SHALL completarse; nuevas invocaciones SHALL ser rechazadas inmediatamente |
| 5 | Cobertura | MEDIA | **FALTA edge case:** ¿El cambio de `sandbox_enabled` tiene efecto inmediato o en próxima publicación? No se especifica. | AC-7 (nuevo): WHEN el creador guarda el formulario de edición, el cambio en `sandbox_enabled` SHALL tener efecto inmediato sin necesidad de re-publicar |
| 6 | Cobertura | MEDIA | **FALTA path de listing:** ¿El marketplace/catálogo filtra o marca visualmente agentes con `sandbox_enabled: false`? Un usuario puede encontrar el agente y no entender por qué no puede probarlo. | AC-8 (nuevo): WHEN `sandbox_enabled: false`, el agente SHALL mostrarse en el marketplace con badge "No sandbox" o equivalente, no ocultarse |
| 7 | Código | ALTA | El query actual en sandbox route no incluye `sandbox_enabled` en el SELECT. Hay que agregarlo explícitamente al select de Supabase. | Agregar `sandbox_enabled` al `.select('id, slug, name, price_per_call, endpoint_url, status, sandbox_enabled')` |
| 8 | Scope | MEDIA | AC-5 ("ambos entornos actualizados") es vago — no especifica qué significa "actualizado". ¿Migration corrida? ¿Feature flag sincronizado? | AC-5-FIX: SHALL existir migration aplicada en prod Y testnet; verification: query directo a ambas DBs confirma columna presente |
| 9 | Dependencias | MEDIA | **FALTA migration explícita.** AC-1 menciona el campo pero no hay AC de migration. Si la migration falla en prod, el deploy rompe. | AC-nuevo: Migration `add_sandbox_enabled_to_agents` SHALL ser idempotente (IF NOT EXISTS) y backfill todos los registros existentes con `true` |
| 10 | Cobertura | BAJA | **FALTA edge case de rate-limit:** ¿El rate-limit de sandbox sigue contando si `sandbox_enabled: false`? (Probablemente no, pero aclararlo) | Agregar nota en scope out o AC explícito |

### Veredicto: NECESITA CAMBIOS
> 3 gaps de alta severidad. Principales: migration no está como AC formal, falta comportamiento en el 403 body, y falta coverage del listing en marketplace.

---

## WAS-204 — Compose retry from failed step

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | AC Quality | CRÍTICA | AC-2 dice "se valida que existe un `pipeline_id` previo con ese step fallido" — pero NO especifica cómo se obtiene el `pipeline_id`. Actualmente el response de `/compose` no incluye `pipeline_id`. | AC-nuevo: WHEN un pipeline falla, el response SHALL incluir `pipeline_id` en el error response junto con `failed_step` y `partial_receipts` |
| 2 | AC Quality | ALTA | AC-4 es ambiguo: "puede pasarse como `initial_input`" — ¿es opcional u obligatorio? Si el step N necesita el output de N-1 y no se pasa, ¿falla silenciosamente o da error claro? | AC-4-FIX: IF `start_from_step > 0` AND `initial_input` no provisto, SHALL retornar 400 con `{ "error": "missing_initial_input", "message": "start_from_step > 0 requires initial_input" }` |
| 3 | AC Quality | ALTA | AC-2 no define el TTL/expiración del `pipeline_id`. Un pipeline de hace 30 días ¿es resumible? | AC-nuevo: Pipeline executions con `status: failed` SHALL ser resumibles por máximo X horas/días (definir valor). Expirados → `pipeline_not_resumable` |
| 4 | Cobertura | CRÍTICA | **FALTA: ¿Quién puede resumir un pipeline?** No hay AC de autorización — ¿cualquier usuario con el `pipeline_id` puede retomarlo? Eso es un vector de seguridad. | AC-nuevo: WHEN `start_from_step` provisto, SHALL verificar que el caller es el mismo `owner_id` del pipeline original; de lo contrario 403 FORBIDDEN |
| 5 | Cobertura | ALTA | **FALTA edge case de concurrencia:** ¿Qué pasa si dos requests intentan resumir el mismo `pipeline_id` simultáneamente? Doble cobro posible. | AC-nuevo: SHALL usar lock optimista (e.g. status transition `failed → resuming` atómica); segundo request SHALL recibir 409 CONFLICT |
| 6 | Cobertura | ALTA | **FALTA: `start_from_step` fuera de rango.** Si el pipeline tiene 3 steps y se pasa `start_from_step: 7`, ¿qué pasa? | AC-nuevo: IF `start_from_step >= total_steps`, SHALL retornar 400 con `invalid_step_index` |
| 7 | Cobertura | MEDIA | **FALTA path de éxito parcial re-retry:** Si el resume también falla en un step posterior, ¿el nuevo `pipeline_id` es el mismo o uno nuevo? El usuario necesita saber qué ID usar para el siguiente retry. | AC-nuevo: WHEN un resume falla, el response SHALL incluir el mismo `pipeline_id` y el nuevo `failed_step` para permitir retry encadenado |
| 8 | Código | CRÍTICA | La nota de diseño dice "requiere persistir outputs por step" pero NO hay AC de migration para `pipeline_executions`. Esto es un prerequisito bloqueante. | AC-nuevo (migration): Tabla `pipeline_executions` SHALL tener columna `step_outputs JSONB` (array indexed by step) antes de que este feature pueda funcionar |
| 9 | Código | ALTA | `MAX_STEPS = 5` — si `start_from_step` puede ser 0..4, la validación de rango debe incluir este límite. No está mencionado en los ACs. | Agregar al AC-1: `N` SHALL estar en rango `[0, MAX_STEPS - 1]` |
| 10 | Scope | MEDIA | **FALTA Scope OUT:** ¿Está en scope reintentar steps individuales dentro de un resume? ¿Modificar los inputs al reintentar? Declarar explícitamente. | Agregar sección Scope OUT: "Modificar parámetros de steps al reintentar — fuera de scope v1" |

### Veredicto: NECESITA CAMBIOS
> 4 gaps críticos o de alta severidad bloqueantes: pipeline_id no expuesto actualmente, autorización faltante (security), concurrencia, y migration faltante. No lanzar sin resolverlos.

---

## WAS-186 — Agent Key scoping por slug o categoría

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | AC Quality | ALTA | AC-3 no especifica el body del error 403. "Mensaje claro" es subjetivo. | AC-3-FIX: SHALL retornar `{ "error": "agent_not_in_scope", "message": "This key is not authorized to invoke agent '{slug}'" }` |
| 2 | AC Quality | MEDIA | AC-5 "Scope visible en dashboard" no especifica qué se muestra cuando el scope está vacío (acceso total). ¿Muestra "All agents" o nada? | AC-5-FIX: WHEN `allowed_slugs` y `allowed_categories` son null/vacíos, SHALL mostrar "Unrestricted (full access)" en dashboard |
| 3 | AC Quality | MEDIA | AC-6 no especifica la estructura de `scope` en el response. ¿Es `{ scope: { slugs: [], categories: [] } }` o flat? | AC-6-FIX: Definir schema: `"scope": { "allowed_slugs": string[] \| null, "allowed_categories": string[] \| null }` |
| 4 | Cobertura | ALTA | **FALTA: ¿Qué pasa si `allowed_slugs` contiene un slug que no existe?** ¿Error al crear la key o se crea igual? | AC-nuevo: WHEN se crea una key con `allowed_slugs`, SHALL validar que cada slug existe en la tabla `agents`; slugs inexistentes → 400 con lista de slugs inválidos |
| 5 | Cobertura | ALTA | **FALTA: Interacción entre `allowed_slugs` y `allowed_categories`.** Si se proveen ambos, ¿es AND u OR? Un agente puede estar en una categoría permitida pero no en el slug permitido. | AC-nuevo: WHEN ambos `allowed_slugs` y `allowed_categories` están presentes, el acceso SHALL ser la UNIÓN (OR) de ambos sets. Documentar explícitamente. |
| 6 | Cobertura | MEDIA | **FALTA edge case:** `allowed_slugs: []` (array vacío) vs `allowed_slugs: null`. ¿Son equivalentes (acceso total) o el primero bloquea todo? | AC-nuevo: `allowed_slugs: []` (array vacío) SHALL tratarse igual que `null` — acceso total. Solo aplica restricción si hay al menos 1 elemento. |
| 7 | Cobertura | MEDIA | **FALTA: ¿El scoping aplica al Compose API?** Si una key con scope usa Compose con un agente fuera del scope, ¿se rechaza por step o por pipeline? | AC-nuevo: WHEN Compose API usa una key con scope, SHALL verificar scope en cada step individualmente; step violando scope → falla ese step con 403 |
| 8 | Código | ALTA | La tabla `agent_keys` no tiene `allowed_slugs` ni `allowed_categories`. **FALTA migration explícita como AC.** | AC-nuevo (migration): `ALTER TABLE agent_keys ADD COLUMN allowed_slugs text[] DEFAULT NULL, ADD COLUMN allowed_categories text[] DEFAULT NULL` |
| 9 | Código | MEDIA | No hay mención de índices en las nuevas columnas. Un check de scope contra `allowed_slugs` en cada invocación podría ser lento sin índice GIN. | Agregar nota técnica: crear índice GIN en `allowed_slugs` y `allowed_categories` para performance en lookups |
| 10 | Scope | BAJA | El Scope OUT menciona "scoping dinámico" pero no excluye explícitamente: revocar slugs, transferir keys entre owners, o herencia de scope entre keys. | Ampliar Scope OUT para cubrir estas áreas |

### Veredicto: NECESITA CAMBIOS
> Migration faltante es bloqueante. Interacción AND/OR entre slugs+categories es ambigüedad crítica que puede generar bugs. Validación de slugs inexistentes es importante para UX.

---

## WAS-187 — Dynamic Discovery en Compose API

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | AC Quality | ALTA | AC-2 "mayor reputation dentro de constraints" — ¿cómo se calcula `reputation`? ¿Es un campo en la tabla `agents`? No está definido en el contexto del código. | AC-2-FIX: Especificar el campo fuente: `min_reputation` compara contra `agents.reputation_score` (definir campo o referencia a feature existente). Si no existe, declarar como dependencia. |
| 2 | AC Quality | ALTA | AC-4 retorna 404 "si no hay agente que cumpla constraints" — pero 404 semánticamente significa "recurso no encontrado". Debería ser 422 o 503. | AC-4-FIX: SHALL retornar 422 con `{ "error": "no_agent_matches", "capability": "...", "constraints": {...} }` — 404 es incorrecto semánticamente aquí |
| 3 | AC Quality | MEDIA | AC-6 `fallback_slug` — si el fallback_slug tampoco está disponible (caído, sin quota), ¿qué ocurre? ¿Falla con el mismo error de discovery o uno diferente? | AC-6-FIX: IF `fallback_slug` también falla, SHALL retornar error indicando tanto el fallo de discovery como el fallo del fallback, con razón de cada uno |
| 4 | Cobertura | ALTA | **FALTA: ¿Cómo se determina si un agente está "disponible"?** Un agente con `status: active` puede estar caído (timeout). ¿Discovery filtra por availability real-time o solo por metadata? | AC-nuevo: Discovery SHALL filtrar por `status: active` Y `sandbox_enabled: true` (si invocado desde sandbox). Health-check real-time está OUT del scope v1 — declarar explícitamente. |
| 5 | Cobertura | ALTA | **FALTA: ¿El `max_price` de constraints respeta el presupuesto restante del usuario?** Si el usuario tiene $0.03 y `max_price: 0.05`, debe usarse el mínimo entre ambos o rechazarse. | AC-nuevo: IF `max_price` en constraints > budget disponible del caller, SHALL usar el budget como límite efectivo o retornar error de presupuesto insuficiente (definir comportamiento) |
| 6 | Cobertura | MEDIA | **FALTA: caching del resultado de discovery.** Dos pipelines simultáneos con misma capability podrían resolver el mismo agente y saturarlo. ¿Hay algún balanceo? | Agregar a Scope OUT: "Load balancing entre agentes con igual reputation — fuera de scope v1" o agregar AC si es requerido |
| 7 | Cobertura | MEDIA | **FALTA: ¿Qué pasa con el `receipt` cuando se usa discovery + fallback?** AC-5 solo menciona `resolved_slug`. Si se usó el fallback, ¿se indica en el receipt? | AC-5-FIX: Receipt SHALL incluir `resolved_slug`, `resolution_method: "discovery" \| "fallback"`, y `discovery_constraints` para trazabilidad completa |
| 8 | Scope | ALTA | **FALTA Scope OUT explícito** sobre: ¿puede un step mezclar `capability` en algunos steps y `agent_slug` en otros del mismo pipeline? AC-3 solo cubre cuando AMBOS se especifican en el MISMO step. | Aclarar que un pipeline PUEDE tener steps mixtos (algunos con slug, otros con capability), siempre que cada step use solo uno |
| 9 | Dependencias | ALTA | **FALTA referencia a WAS-186 (Agent Key scoping).** Si una key con scope usa un pipeline con dynamic discovery, el agente resuelto podría estar fuera del scope de la key. ¿Cómo interactúan? | Declarar dependencia en WAS-186 y agregar AC: WHEN un agente resuelto por discovery viola el scope de la Agent Key, SHALL retornar error de scope, no continuar |
| 10 | Código | MEDIA | No hay tabla ni campo `capabilities` mencionado en el código existente. ¿Los agentes tienen una columna `capabilities: string[]` en la tabla? Si no, esto requiere una migration no mencionada. | AC-nuevo (migration/prerequisito): Tabla `agents` SHALL tener columna `capabilities text[]` indexada con GIN. Si ya existe, marcar ALREADY_IMPLEMENTED. |

### Veredicto: NECESITA CAMBIOS
> Feature incompleta a nivel de diseño. Campo `reputation` y `capabilities` en tabla `agents` no confirmados — son prerequisitos. Interacción con WAS-186 es un security gap. Semántica de error 404 incorrecta.

---

## WAS-200 — Input Schema + validación pre-cobro

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | AC Quality | ALTA | AC-4 "valida el input contra `input_schema`" — no especifica qué librería/spec de JSON Schema se usa. ¿JSON Schema Draft-07? ¿AJV? El comportamiento de validación varía entre implementaciones. | AC-4-FIX: Especificar: validación SHALL usar JSON Schema Draft-07 vía AJV (o equivalente); el error SHALL incluir el path del campo fallido en formato JSON Pointer |
| 2 | AC Quality | MEDIA | AC-2 "acepta `input_schema` al crear/editar" — no especifica si el schema en sí se valida antes de guardarlo. Un schema malformado podría romper todas las futuras invocaciones del agente. | AC-2-FIX: WHEN se guarda `input_schema`, SHALL validarse que es un JSON Schema válido; schema inválido → 400 con detalle del error de meta-validación |
| 3 | AC Quality | MEDIA | AC-5 "sección para definir el schema con ejemplos" — "con ejemplos" es ambiguo. ¿El creador puede definir ejemplos en la UI o solo se muestran ejemplos de la UI de WasiAI? | AC-5-FIX: La UI SHALL permitir al creador ingresar al menos 1 ejemplo de input/output que se guarda como `schema_examples JSONB` en la tabla `agents` |
| 4 | Cobertura | ALTA | **FALTA: ¿Qué pasa con agentes que reciben inputs en formato no-JSON (texto libre, multipart)?** Un schema JSON no aplica a texto plano. | AC-nuevo: IF el `Content-Type` del request al agente no es `application/json`, SHALL saltar la validación de schema aunque `input_schema` esté definido (o retornar error de tipo indicando que el agente requiere JSON) |
| 5 | Cobertura | ALTA | **FALTA: ¿Quién puede modificar el `input_schema` después de publicado?** Si un creador cambia el schema de una versión a otra, los usuarios que ya tienen integraciones con el schema anterior se rompen. | AC-nuevo: WHEN `input_schema` cambia en un agente ya publicado, SHALL mostrarse advertencia al creador indicando breaking change potencial. Versionado de schema OUT de scope v1. |
| 6 | Cobertura | MEDIA | **FALTA: Tamaño máximo del `input_schema`.** Un schema arbitrariamente grande podría usarse como vector de DoS (validación costosa). | AC-nuevo: `input_schema` SHALL tener tamaño máximo de 64KB; schemas mayores → 400. Schemas con más de N niveles de anidamiento → 400. |
| 7 | Cobertura | MEDIA | **FALTA edge case:** ¿Qué pasa si el `input_schema` referencia `$ref` externos (http://...)? Esto podría usarse para SSRF o para validaciones que dependen de recursos externos. | AC-nuevo: SHALL rechazar schemas que contengan `$ref` con URLs externas (solo se permiten `$ref` internos/relativos); retornar 400 con `external_refs_not_allowed` |
| 8 | AC Quality | MEDIA | AC-6 "al menos 1 ejemplo de input/output" — ¿dónde vive este dato? No hay campo en la tabla para ejemplos. ¿Se deduce del schema? | Requiere campo adicional en migration: `schema_examples JSONB` nullable en tabla `agents` |
| 9 | Código | ALTA | **FALTA migration explícita como AC.** AC-1 menciona la migration pero no hay AC formal que especifique rollback strategy ni que la migration sea idempotente. | AC-1-FIX: Migration `add_input_schema_to_agents` SHALL ser idempotente; incluir `schema_examples JSONB DEFAULT NULL` en la misma migration |
| 10 | Dependencias | MEDIA | AC-4 afecta tanto Compose API (WAS-187) como `/models/:slug/invoke`. Si WAS-187 cambia cómo funciona el invoke, hay riesgo de conflicto en la validación. Declarar dependencia. | Agregar: "WAS-200 debe coordinarse con WAS-187 — la validación de schema ocurre antes del dynamic discovery o después de resolver el slug" |

### Veredicto: NECESITA CAMBIOS
> Meta-validación del schema (AC-2) es crítica — un schema inválido puede romper el agente para todos los usuarios. SSRF via `$ref` externos es un security gap. Migration necesita campo `schema_examples`.

---

## WAS-203 — Cloudflare proxy app.wasiai.io (FAST-FIX)

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | AC Quality | ALTA | AC-1 "nube naranja en panel CF" es verificación manual, no automatizada. No hay AC de cómo se verifica programáticamente en CI/deploy. | AC-1-FIX: Agregar smoke test post-deploy: `curl -I https://app.wasiai.io` SHALL incluir header `cf-ray` en la respuesta (indicador de que pasó por CF) |
| 2 | AC Quality | ALTA | AC-2 "`cf-connecting-ip` presente en requests" — no especifica QUÉ requests. ¿Solo en producción? ¿En todos los endpoints incluyendo webhooks? | AC-2-FIX: SHALL verificarse en al menos: `/api/v1/sandbox/invoke/*`, `/api/v1/compose`, `/api/v1/agent-keys` — los endpoints que usan rate limiting por IP |
| 3 | AC Quality | MEDIA | AC-3 "no regresión en auth, pagos, sandbox" es demasiado amplio para ser testeable. Necesita criterios concretos. | AC-3-FIX: Smoke tests post-activación: (a) login OAuth completa, (b) payment flow completa en testnet, (c) sandbox invocation con créditos virtuales — todos SHALL retornar 2xx |
| 4 | Cobertura | CRÍTICA | **FALTA: Plan de rollback.** Si activar CF proxy rompe algo (SSL mismatch, headers incorrectos, Vercel headers bloqueados), ¿cómo se revierta? FAST-FIX implica velocidad — rollback debe ser < 5 min. | AC-nuevo: SHALL existir plan de rollback documentado: cambio de CNAME de vuelta a `cname.vercel-dns.com` SHALL restaurar el servicio en < 5 min. TTL del DNS SHALL estar en 60s antes del cambio. |
| 5 | Cobertura | ALTA | **FALTA: ¿Qué pasa con el certificado SSL?** CF tiene su propio SSL. Vercel también genera certs. Si ambos están activos puede haber doble cifrado o conflicto. Modo SSL de CF (flexible vs full vs full strict) no especificado. | AC-nuevo: CF SSL mode SHALL configurarse en "Full (strict)" con cert válido en Vercel. Verificar que HTTPS funciona end-to-end sin warnings de cert. |
| 6 | Cobertura | ALTA | **FALTA: Headers que Vercel necesita vs headers que CF modifica.** CF puede modificar/bloquear headers que Vercel usa para auth (e.g., `x-vercel-forwarded-for`). | AC-nuevo: Verificar que headers de Vercel necesarios para funcionalidad (auth tokens, CSRF) no son alterados por CF WAF rules por defecto. |
| 7 | Cobertura | MEDIA | **FALTA: Cache de CF.** Por defecto CF puede cachear assets estáticos de Next.js. Rutas de API (`/api/v1/*`) deben tener `Cache-Control: no-store` o CF page rule para no cachearse. | AC-nuevo: SHALL configurar CF page rule o cache rule: `/api/v1/*` SHALL tener cache desactivado (Bypass cache). Verificar que responses dinámicos no son servidos desde cache CF. |
| 8 | Cobertura | MEDIA | **FALTA: Rate limiting de CF vs rate limiting de la app.** CF puede rate-limit por IP antes de que llegue a la app. ¿Esto interfiere con el rate limiting propio de WasiAI? | Agregar a scope: revisar CF rate limiting defaults y desactivar o calibrar para no conflictuar con el rate limiting propio de la app |
| 9 | Scope | ALTA | El trabajo dice "cambiar nameservers OR solo el registro A/CNAME con proxied:true". Esta ambigüedad en el approach puede resultar en configuración inconsistente. | Definir approach: EITHER cambiar nameservers completos a CF (afecta todo el dominio `wasiai.io`) OR agregar solo el CNAME de `app.wasiai.io` con proxy. Segundo approach es más seguro como FAST-FIX. |
| 10 | Dependencias | ALTA | **FALTA: Verificar que Hostinger permite cambiar solo un subdominio a CF sin mover nameservers completos.** Algunos registradores no lo permiten. Si requiere mover nameservers, el impacto es todo `wasiai.io`, no solo `app.`. | AC-nuevo: BEFORE ejecutar, confirmar con Hostinger que CNAME con proxied CF es posible sin cambio de nameservers. Si no, definir scope de impacto. |

### Veredicto: NECESITA CAMBIOS
> FAST-FIX pero con alta complejidad operacional. Falta plan de rollback (crítico), configuración SSL no especificada, y ambigüedad en approach DNS que puede afectar todo el dominio. Requiere checklist pre-cambio.

---

## Resumen Ejecutivo

| Issue | Veredicto | Gaps Críticos |
|-------|-----------|---------------|
| WAS-196 | NECESITA CAMBIOS | Migration sin AC formal, body del 403 no definido, comportamiento en listing |
| WAS-204 | NECESITA CAMBIOS | `pipeline_id` no expuesto, autorización faltante (security), concurrencia, migration |
| WAS-186 | NECESITA CAMBIOS | Migration faltante, ambigüedad AND/OR entre scopes, validación de slugs inexistentes |
| WAS-187 | NECESITA CAMBIOS | Campo `reputation`/`capabilities` no confirmado, interacción con WAS-186, error 404 incorrecto |
| WAS-200 | NECESITA CAMBIOS | Meta-validación de schema, SSRF via `$ref` externos, campo `schema_examples` faltante |
| WAS-203 | NECESITA CAMBIOS | Plan de rollback faltante (crítico), SSL mode no especificado, approach DNS ambiguo |

**Ningún Work Item está listo para desarrollo en su estado actual.**

Los más críticos para resolver primero (por riesgo de seguridad):
1. **WAS-204** — Autorización en resume de pipelines (cualquiera con un `pipeline_id` podría retomar pipelines ajenos)
2. **WAS-203** — Plan de rollback antes de ejecutar el FAST-FIX
3. **WAS-200** — SSRF via `$ref` en schemas externos
4. **WAS-186** — Migration es prerequisito bloqueante

_Generado por NexusAgile Requirements Reviewer v1.3_
