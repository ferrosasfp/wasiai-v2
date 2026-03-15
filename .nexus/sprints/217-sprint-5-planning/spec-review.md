# Spec Review — Sprint 5 WasiAI
> Revisado por: Spec Reviewer (NexusAgil v1.3)
> Fecha: 2026-03-14
> Repo: `/home/ferdev/.openclaw/workspace/wasiai-v2`

---

## Spec Review — F-02 (DNS Rebinding)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | `validateEndpointUrlAsync` sigue retornando `Promise<void>`; `health-probe.ts` sigue usando `fetch(endpointUrl)` sin IP |
| 0.2 Archivos referenciados existen | ✅ OK | `src/lib/security/validateEndpointUrl.ts` ✓ `src/lib/agents/health-probe.ts` ✓ |
| 0.3a Tipos/imports correctos | ⚠️ BLOCKER | `HealthCheckResult.reason` type = `'timeout' \| 'http_error' \| 'connection_error' \| 'ssrf_blocked'`. El SDD introduce `'dns_rebinding_blocked'` en AC-2 y AC-4 pero **nunca instruye al Builder a actualizar el union type**. TypeScript compile error garantizado. |
| 0.3b Tipos DB | N/A | No hay cambios de DB en este SDD |
| 0.4 Dependencias | ✅ OK | Sin dependencias externas |
| 0.5 SDD completo | ⚠️ Ver Findings | Ambigüedad técnica crítica en SNI/TLS |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | 🔴 BLOCKER | `HealthCheckResult.reason` type en `health-probe.ts` línea 13 NO incluye `'dns_rebinding_blocked'`. El SDD no instruye a actualizar el union type. El Builder obtendrá TypeScript error al asignar `reason: 'dns_rebinding_blocked'`. | Añadir en Constraint Directives: "OBLIGATORIO: Añadir `'dns_rebinding_blocked'` al union type `HealthCheckResult.reason` en `health-probe.ts`" |
| 2 | 🔴 BLOCKER / ARQUITECTURAL | **SNI/TLS con fetch nativo**: construir URL como `https://<IP>/path` + `Host: hostname` header **NO resuelve el SNI** en Node.js fetch nativo. El TLS handshake usará la IP como Server Name Indicator, lo que causará fallo de validación de certificado en la gran mayoría de endpoints públicos (cert emitido para dominio, no para IP). El SDD anota esto como "riesgo aceptado" pero el impacto es que **TODOS los probes de endpoints válidos fallarían**. Esto haría el fix contraproducente. | Evaluar alternativas: (a) usar `node:https` con `servername` option explícito en lugar de fetch nativo, (b) usar `undici` con `connect.servername`, o (c) reconocer que el fix funciona solo para servidores sin SNI estricto y documentar esto explícitamente con un test. Si se acepta el tradeoff, el SDD debe indicar que la cobertura real de la mitigación es limitada a servidores que toleran IP directa en TLS. |
| 3 | 🟡 MEDIO | El SDD dice en AC-4: "DNS resolution falla → `reason: 'dns_rebinding_blocked'`" pero actualmente ese error ya es capturado en el `catch` de `probeEndpoint` como `ssrf_blocked` (el `validateEndpointUrlAsync` lanza Error). El SDD no indica cómo distinguir el nuevo `dns_rebinding_blocked` del `ssrf_blocked` existente en el caller de `health-probe.ts`. | En el SDD, especificar cómo `probeEndpoint` distingue el tipo de error (e.g., inspeccionar `err.message` o crear un tipo de error específico `DnsRebindingError`). |
| 4 | 🟢 INFO | Callers de `validateEndpointUrlAsync` que ignoran el retorno: `test-endpoint/route.ts`, `register/route.ts`, `mcp/route.ts` — todos confirmados como `await validateEndpointUrlAsync(...)` sin capturar retorno. Cambiar `void` → `string` es backward compatible. ✓ | Ninguna. El análisis del SDD es correcto. |
| 5 | 🟢 INFO | AC-6 sobre preservar puerto: correcto. URL con IPv6 entre corchetes: correcto. | Sin acción. |

**Coherencia SDD:**
- ACs tienen implementación razonablemente clara excepto distinguir errores (Finding 3)
- Rollback: ✅ No hay cambios de DB/schema, rollback es revert del commit
- PROHIBIDO: ✅ 4 directivas (cumple ≥3)

### Veredicto: NECESITA CORRECCIÓN

**Bloqueantes:** Finding 1 (tipo TS), Finding 2 (SNI/TLS). El Finding 2 es arquitectural y requiere decisión del Architect antes de que el Builder implemente.

---

## Spec Review — F-03 (SERVICE_ROLE comment)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | No hay comentario `SECURITY_NOTE` en `health-probe.ts` cerca de `createServiceClient()` |
| 0.2 Archivos referenciados existen | ✅ OK | `src/lib/agents/health-probe.ts` ✓ |
| 0.3a Código correcto | ✅ OK | `const serviceClient = createServiceClient()` está en la primera línea de `probeEndpoint` (línea 19). Posición clara. |
| 0.3b Tipos DB | N/A | Sin cambios |
| 0.4 Dependencias | N/A | Sin dependencias |
| 0.5 SDD completo | ✅ OK | Scope mínimo y bien acotado |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | 🟢 INFO | El SDD no incluye sección de Rollback explícita. Para un cambio de 3-5 líneas de comentario, no es crítico pero completa el formato NexusAgil. | Añadir "Rollback: revert commit. Sin impacto funcional." |
| 2 | 🟢 INFO | El AC-1 dice "línea antes de `const serviceClient = createServiceClient()`" — confirmado que esta llamada existe dentro de `probeEndpoint` en la línea 19 del archivo. Posición correcta según AC-2. ✓ | Sin acción. |

**Coherencia SDD:**
- ACs claros y no ambiguos ✅
- Rollback: ausente (no es bloqueante para un comentario)
- PROHIBIDO: ✅ 4 directivas (cumple ≥3)

### Veredicto: LISTO

---

## Spec Review — WAS-191 (performance_score badge UI)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | No hay `PerformanceBadge` component. `performance_score` no aparece en `page.tsx` |
| 0.2 Archivos referenciados existen | ✅ OK | `src/app/[locale]/models/[slug]/page.tsx` ✓, `src/features/reputation/components/AgentRating.tsx` ✓ |
| 0.3a Tipos — Model interface | 🔴 BLOCKER | `Model` interface en `src/features/models/types/models.types.ts` **NO incluye `performance_score`**. El SDD anota esto como "riesgo: Media" pero sin instrucción explícita de cómo resolverlo. El Builder obtendrá TypeScript error al acceder a `model.performance_score`. |
| 0.3a i18n namespace | 🔴 BLOCKER | `useTranslations('models')` — namespace `'models'` **NO EXISTE** en `messages/en.json` ni `es.json`. Namespaces disponibles incluyen: `modelDetail`, `marketplace`, `agent`, `rating`. El componente fallaría en runtime. |
| 0.3b Tipos DB | ✅ OK | `performance_score DECIMAL(5,1) NULL` — se confirma existencia en migración 058 (WAS-213). `getModelBySlug` usa `select('*, creator:...')` lo cual trae todos los campos del agente, incluyendo `performance_score` en runtime. |
| 0.4 Dependencias | ✅ OK | WAS-213 migración 058 marcada como done en el SDD |
| 0.5 SDD completo | ⚠️ Ver Findings | Ambigüedad en namespace i18n y falta instrucción para update de tipo |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | 🔴 BLOCKER | `Model` type en `models.types.ts` no incluye `performance_score`. El SDD menciona el riesgo pero lo deja como "verificar antes de implementar" sin instrucción clara. TypeScript compile error en `page.tsx` y en `PerformanceBadge.tsx`. | Añadir en Constraint Directives OBLIGATORIO: "Añadir `performance_score: number \| null` a la interface `Model` en `src/features/models/types/models.types.ts` con comentario `// WAS-213`." |
| 2 | 🔴 BLOCKER | Namespace `'models'` no existe en `messages/en.json` ni `es.json`. Usar `useTranslations('models')` causará error de next-intl en runtime. | Cambiar a namespace existente. Opción recomendada: `useTranslations('modelDetail')` (ya importado en la página) o `useTranslations('agent')`. Añadir las claves `performanceBadge.*` a ese namespace en lugar de crear `models`. El SDD debe especificar el namespace correcto. |
| 3 | 🟡 MEDIO | El SDD dice posicionar el badge "junto al `AgentRating`" pero `AgentRating` está al final del sidebar (último elemento). Si el badge va en el mismo sidebar, está "below the fold". El SDD dice "debe estar above the fold". Hay contradicción. | Especificar ubicación exacta: ¿en el header card donde están los badges de categoría/featured (línea ~85 en page.tsx), o en el sidebar junto a `AgentRating`? |
| 4 | 🟢 INFO | La página es un Server Component (`async function`). `PerformanceBadge` como `'use client'` con `useTranslations` es correcto — next-intl soporta esta combinación. ✓ | Sin acción. |

**Coherencia SDD:**
- ACs: presentes pero AC sobre posición del badge es ambiguo (Finding 3)
- Rollback: ✅ No hay cambios de DB. Revert commit.
- PROHIBIDO: ✅ 4 directivas

### Veredicto: NECESITA CORRECCIÓN

**Bloqueantes:** Finding 1 (tipo TS), Finding 2 (namespace i18n inexistente).

---

## Spec Review — WAS-199 (/reputation endpoint gaps)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | SELECT actual confirmado: `'id, total_calls, reputation_score, is_verified, last_health_check_ok, last_health_check_at'`. Faltan `performance_score` y `reputation_count`. Response JSON tampoco los incluye. |
| 0.2 Archivos referenciados existen | ✅ OK | `src/app/api/v1/agents/[slug]/reputation/route.ts` ✓, `src/app/api/v1/agents/[slug]/route.ts` ✓ |
| 0.3a Código correcto | ✅ OK | Pattern de `agent.performance_score ?? null` en `agents/[slug]/route.ts` es válido exemplar. |
| 0.3b Tipos DB | ✅ OK | `reputation_score DECIMAL(3,2)` → 0-1 range confirmado ✓. `reputation_count INT` confirmado ✓. `performance_score DECIMAL(5,1) NULL` confirmado ✓. |
| 0.4 Dependencias | ✅ OK | WAS-213 done |
| 0.5 SDD completo | ✅ OK | Cambios claramente especificados |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | 🟡 MEDIO | El SDD dice añadir al SELECT: `'id, total_calls, reputation_score, reputation_count, is_verified, last_health_check_ok, last_health_check_at, performance_score'`. Nótese que `reputation_score` YA está en el SELECT actual — no es un campo nuevo a añadir al SELECT, solo al response JSON. El SDD no hace esta distinción explícita. El Builder podría confundirse y duplicar el campo o malinterpretar qué cambia. | Clarificar en el SDD que `reputation_score` ya está en SELECT y solo necesita añadirse al JSON response. Solo `reputation_count` y `performance_score` son campos nuevos en el SELECT. |
| 2 | 🟢 INFO | `erc8004_score = agent.reputation_score ?? null` — la lógica es clara y simple. `reputation_score` en DB es 0-1, que coincide con el standard ERC-8004. ✓ | Sin acción. |
| 3 | 🟢 INFO | `dispute_rate: 0` y `erc8004_score: null` son placeholders actuales. El SDD corrige correctamente `erc8004_score`. `dispute_rate` permanece como placeholder per SDD scope. ✓ | Sin acción. |

**Coherencia SDD:**
- ACs implícitos pero claros via el design técnico (sección 4.3)
- Rollback: ✅ No hay cambios de DB. Revert commit.
- PROHIBIDO: ✅ 5 directivas

### Veredicto: LISTO

*(Finding 1 es una aclaración editorial, no un bloqueante técnico)*

---

## Spec Review — WAS-187 (discoverAgent ranking)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | `performance_score` no está en SELECT de `agent-discovery.ts`. Ordering solo usa `reputation_score`. `DiscoveryConstraints` no tiene `min_performance`. `DiscoveredAgent` interface no tiene `performance_score`. |
| 0.2 Archivos referenciados existen | ✅ OK | `src/lib/agent-discovery.ts` ✓, `src/app/api/v1/compose/route.ts` ✓ |
| 0.3a Tipos/código correcto | ✅ OK | Cambios propuestos son correctos y completos. Supabase `.order(..., { nullsFirst: false })` mapea a `NULLS LAST` en PostgreSQL — correcto para excluir nulls del top. |
| 0.3b Tipos DB | ✅ OK | `performance_score DECIMAL(5,1) NULL` ✓, `reputation_score DECIMAL(3,2)` ✓ |
| 0.4 Dependencias | ✅ OK | WAS-213 done |
| 0.5 SDD completo | ⚠️ Ver Findings | Gap de documentación en compose route |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | 🟡 MEDIO | `src/app/api/v1/compose/route.ts` tiene su propia interface local `constraints` (línea 62-66) que solo incluye `max_price_usdc`, `min_reputation`, `category`. Cuando WAS-187 añada `min_performance` a `DiscoveryConstraints` en `agent-discovery.ts`, los pipelines que usan compose **no podrán pasar `min_performance`** porque el tipo local de compose no lo incluye. El SDD dice compose "no requiere cambios" pero no documenta esta limitación. | Documentar en el SDD: "NOTA: `min_performance` no será accesible vía compose pipeline API en este sprint. Para habilitarlo en compose, se requiere actualización de `ComposeStep.constraints` interface en un sprint posterior." O alternativamente, incluir el update de compose en scope. |
| 2 | 🟢 INFO | `.gte('performance_score', value)` con campos null: PostgreSQL excluye rows con NULL en comparaciones, por lo que `min_performance: 90` filtrará correctamente agentes sin `performance_score`. SDD lo documenta. ✓ | Sin acción. |
| 3 | 🟢 INFO | `capabilities` está en el SELECT actual pero no en la interface `DiscoveredAgent`. Este es comportamiento pre-existente. El SDD no lo cambia y es correcto. ✓ | Sin acción. |

**Coherencia SDD:**
- ACs claros y completos (vía diseño técnico secciones 4.2-4.6)
- Rollback: ✅ No hay cambios de DB. Revert commit.
- PROHIBIDO: ✅ 5 directivas

### Veredicto: LISTO

*(Finding 1 es una limitación de diseño documentable, no un bug técnico)*

---

## Resumen Sprint 5 — Spec Review

| Issue | Veredicto | Bloqueantes |
|-------|-----------|-------------|
| F-02 | ⛔ NECESITA CORRECCIÓN | (1) `'dns_rebinding_blocked'` no está en `HealthCheckResult.reason` union type — TypeScript error. (2) SNI/TLS con fetch nativo + URL de IP: todos los probes fallarían con la mayoría de endpoints públicos. Requiere decisión arquitectural antes de implementar. |
| F-03 | ✅ LISTO | Ninguno. |
| WAS-191 | ⛔ NECESITA CORRECCIÓN | (1) `Model` type no incluye `performance_score` — TypeScript error. (2) Namespace `useTranslations('models')` no existe en messages — runtime error. |
| WAS-199 | ✅ LISTO | Ninguno. (Finding editorial menor sobre qué campos son realmente nuevos en SELECT vs response.) |
| WAS-187 | ✅ LISTO | Ninguno. (Finding de documentación: `min_performance` no accesible desde compose API en este sprint.) |

### Acciones requeridas antes de Build

**F-02** — Requiere revisión del Architect para resolver el dilema SNI/TLS. Opciones:
1. Usar `undici` / `node:https` con `servername` explícito para resolver correctamente
2. Limitar el fix a "DNS resolution falla → bloquear" sin el step de usar IP en fetch (solución parcial, menor complejidad)
3. Documentar explícitamente que el probe puede fallar en endpoints con SNI estricto y esto es aceptado

**WAS-191** — El SDD necesita 2 correcciones concretas:
1. Añadir directiva OBLIGATORIO para actualizar `Model` interface
2. Cambiar namespace i18n a uno existente (recomendado: `'modelDetail'`) y aclarar ubicación del badge
