# Requirements Review — Sprint 5

> Revisor: San (NexusAgil Requirements Reviewer v1.3)
> Fecha: 2026-03-14
> Metodología: encontrar lo que FALTA, no validar lo que hay.

---

## F-02 — DNS rebinding en health-probe

### Análisis de código actual

`health-probe.ts` ya llama `validateEndpointUrlAsync(endpointUrl)` (importado de `src/lib/security/validateEndpointUrl.ts`), que:
- Resuelve el hostname vía `dns.lookup` con `{ all: true }`
- Valida cada IP resuelta contra prefijos RFC1918 + IPv6 privados
- Lanza error si alguna IP es privada, o si DNS falla (ENOTFOUND, ETIMEOUT, EAI_AGAIN)

Tras la validación, el probe hace `fetch(endpointUrl)` — **no fetch via IP resuelta**.

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP crítico | ALTA | AC1 especifica error code `dns_rebinding_blocked` pero el código retorna `reason: 'ssrf_blocked'`. Campo semántico diferente. El AC debe alinearse con el código o el código debe añadir distinción entre SSRF genérico vs DNS rebinding específico. | AC1: especificar `reason: 'ssrf_blocked'` (campo existente) con `message` que distinga "DNS rebinding detected" vs "private IP literal". O añadir campo `sub_reason: 'dns_rebinding'`. |
| 2 | GAP funcional | ALTA | AC3 pide "fetch via IP resuelta con header `Host: <hostname>`" — NO implementado. `validateEndpointUrlAsync` valida pero no retorna la IP resuelta. El `fetch(endpointUrl)` posterior permite que el SO re-resuelva el hostname (segunda resolución DNS = ventana de rebinding). | AC3 requiere refactorizar `validateEndpointUrlAsync` para retornar `{ resolvedIp: string }` y usar `fetch(\`https://${resolvedIp}/...\`, { headers: { Host: hostname } })`. Esto es el fix real del vector. |
| 3 | GAP funcional | MEDIA | AC4 (concurrencia) — no hay mecanismo de idempotencia. Si dos probes se ejecutan simultáneamente para el mismo `agentId`, ambos pueden hacer el `updateAgentHealth` con resultados distintos, dejando el estado en el que llegue el segundo (race condition). No hay lock, no hay upsert con condición de timestamp. | AC4: añadir `last_checked_at > $current_probe_start` guard en el UPDATE, o usar Supabase upsert con condición. Alternativamente, especificar que "NULLS LAST wins" y documentarlo. |
| 4 | GAP de especificación | MEDIA | AC2 dice "marcar agente como `reviewing`" en fallo DNS. El código ya hace esto (captura el throw de `validateEndpointUrlAsync` → `updateAgentHealth(..., 'reviewing', { reason: 'ssrf_blocked' })`). Pero el AC no especifica qué `reason` aparece en `health_check`. Falta testabilidad del campo. | AC2: añadir "con `health_check.reason = 'ssrf_blocked'` y `message` que contenga el hostname que falló". |
| 5 | GAP de edge case | BAJA | No hay AC para el caso en que `endpointUrl` tiene IP literal (no hostname) que sea RFC1918. Ejemplo: `https://192.168.1.1/probe`. El código lo bloquea vía `isBlockedHost`, pero no está cubierto en los ACs. | AC5 (nuevo): WHEN endpointUrl contiene IP literal RFC1918 (sin DNS resolution), THE probe SHALL abort con `ssrf_blocked`. |
| 6 | GAP de edge case | BAJA | No hay AC para HTTPS en Edge runtime donde DNS probe se silencia. `validateResolvedIPs` tiene un silent fallback si el módulo `node:dns` no está disponible. Si el probe corre en Edge (raro, pero posible), la protección DNS rebinding no aplica. | Aclarar en scope: "probe corre SOLO en Node.js runtime". Añadir runtime guard explícito o test que verifique que el probe nunca se ejecuta en Edge. |

### Veredicto: NECESITA CAMBIOS

**Bloqueante:** Gap #2 (AC3 no implementado — es el fix real del vector de DNS rebinding). Gap #1 (nomenclatura inconsistente de error codes).

---

## F-03 — SERVICE_ROLE en probe (documentar)

### Análisis de código actual

`health-probe.ts` línea 5: `import { createServiceClient } from '@/lib/supabase/server'`
Línea 20: `const serviceClient = createServiceClient()`

No existe ningún comentario `// SECURITY_NOTE` en el archivo.

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP funcional | MEDIA | AC1 requiere comentario `// SECURITY_NOTE` — no existe. El fix es trivial pero sin él el AC no se puede verificar. | Añadir comentario en línea 20 (o encima de `createServiceClient()`). |
| 2 | GAP de alcance | BAJA | AC2 exige que el comentario mencione que el scope está limitado a `agents` table. Sin esta cláusula, el comentario podría existir pero ser incompleto. Especificar el texto mínimo requerido haría el AC más testeable. | AC2: añadir criterio "el comentario SHALL incluir literalmente las palabras 'agents table' y 'no user session'". |
| 3 | GAP no mencionado | BAJA | No hay AC que cubra qué pasa si `createServiceClient()` falla (ej: env var `SERVICE_ROLE_KEY` no configurada). El probe fallaría silenciosamente sin actualizar el estado del agente. | AC3 (nuevo): WHEN `createServiceClient()` lanza, THE probe SHALL loguear el error con `console.error` y retornar sin crash (ya que es fire-and-forget). |
| 4 | GAP de dependencia | INFO | Los ACs no mencionan que este comentario debe sobrevivir futuras refactorizaciones. Si alguien reemplaza `createServiceClient` por `createClient` para "simplificar", el service role se pierde silenciosamente. | Considerar añadir un test que verifique que `probeEndpoint` usa service client (mock de imports). |

### Veredicto: NECESITA CAMBIOS (minor)

**Bloqueante:** Gap #1 — sin el comentario el AC falla en review. El resto son mejoras.

---

## WAS-191 — performance_score en perfil UI

### Análisis de código actual

`page.tsx` obtiene el `model` vía `getModelBySlug(slug)`. La página muestra `AgentRating` (votos), `ReputationMetrics` (métricas operacionales), y datos del modelo. No hay ningún badge de `performance_score`. El campo `performance_score` depende de WAS-213 (marcado como done en el backlog).

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP funcional | ALTA | AC1-5 requieren un badge de `performance_score`. No existe. Pero antes: ¿`getModelBySlug` devuelve `performance_score`? El SELECT en ese service no está en el código revisado. Si no lo incluye, el badge no puede renderizarse sin cambiar la query. | Añadir AC0 (prerequisito): WHEN `getModelBySlug(slug)` es llamado, THE response SHALL incluir campo `performance_score`. Verificar `models.service.ts`. |
| 2 | GAP de especificación | ALTA | Los ACs no especifican DÓNDE en el layout aparece el badge. ¿Sidebar? ¿Header? ¿Junto a AgentRating? Sin ubicación, el implementador puede ponerlo en cualquier lugar y el AC pasa, pero el UX puede ser inconsistente. | Añadir: "el badge SHALL renderizarse en el sidebar, debajo de `AgentRating`, con el mismo contenedor visual." |
| 3 | GAP de i18n | MEDIA | La etiqueta "Performance" hardcodeada no tiene clave de traducción. El proyecto usa `next-intl` y todas las etiquetas van por `getTranslations`. | AC6 (nuevo): WHEN badge se renderiza, THE etiqueta "Performance" SHALL usar clave de traducción `modelDetail.performanceScore` o similar. |
| 4 | GAP de fuente de datos | MEDIA | AC1 dice "GET /models/:slug y el agente tiene performance_score no null" — esto implica que la página obtiene `performance_score` del modelo, pero el endpoint `GET /api/v1/agents/:slug` también lo devuelve (según el enunciado). ¿Cuál es la fuente canónica para esta UI? Si es el modelo cargado en SSR, ¿el campo está en la tabla? Si requiere llamada al endpoint, se añade una fetch extra en SSR. | Clarificar: "performance_score es un campo de la tabla `agents`, fetcheado en `getModelBySlug`" vs "se obtiene vía client fetch a /api/v1/agents/:slug". |
| 5 | GAP de edge case | BAJA | No hay AC para `performance_score = 0`. Con el umbral AC5 (`< 70` → rojo), score 0 es rojo. ¿Pero 0 es un valor válido diferente de null? ¿Debe mostrar "0" o tratarse como "insuficiente data"? | AC7 (nuevo): WHEN `performance_score = 0`, THE badge SHALL mostrar el valor "0" en rojo (no "No data"). |
| 6 | GAP de accesibilidad | BAJA | No hay AC sobre accesibilidad del badge (aria-label, contrast). Badge de color sin texto puede fallar WCAG. | Mínimo: color badges deben tener aria-label con descripción textual del estado. |

### Veredicto: NECESITA CAMBIOS

**Bloqueante:** Gap #1 (no sabemos si `getModelBySlug` incluye `performance_score`) y Gap #2 (sin ubicación el AC no es verificable).

---

## WAS-199 — /reputation endpoint gaps

### Análisis de código actual

El endpoint existe. Response actual incluye: `score`, `p50_ms`, `p95_ms`, `error_rate_7d`, `error_rate_sample_size`, `trend`, `last_invocation_at`, `is_available`, `is_verified`, `invocation_count`, `dispute_rate`, `erc8004_score: null`.

El SELECT de agents: `'id, total_calls, reputation_score, is_verified, last_health_check_ok, last_health_check_at'`.

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP funcional | ALTA | AC1: `performance_score` no está en el SELECT ni en el response. Para incluirlo, se debe añadir al SELECT y al JSON de respuesta. Depende de WAS-213 (done). | Sin cambio adicional al AC, solo confirmar que WAS-213 añadió el campo a la tabla `agents`. |
| 2 | GAP funcional | ALTA | AC2: `reputation_score` (votos) SÍ está en el SELECT (`reputation_score`) pero NO está en el JSON de respuesta. El campo existe en DB pero no se serializa. Fix es trivial (añadir al return). | El AC está bien especificado; es un bug de implementación, no un gap de AC. |
| 3 | GAP de nomenclatura | MEDIA | AC3: `erc8004_score` actualmente es `null` (placeholder). El AC pide que sea `reputation_score` (votos) normalizado 0.0-1.0. Pero `reputation_score` en DB es 0-100 ya (¿o es raw?). El AC no especifica la fórmula de normalización exacta. Si `reputation_score` ya es 0-100, la fórmula sería `reputation_score / 100`. Pero si hay votos binarios UP/DOWN, la escala puede ser diferente. | AC3: añadir fórmula explícita: `erc8004_score = reputation_score / 100` (float 0.0-1.0, null si reputation_score es null). |
| 4 | GAP de especificación | MEDIA | AC4: `format_compliance_pct` debe ser `null` con nota "coming in WAS-202". Actualmente el campo no existe en el response en absoluto. El AC pide que esté presente como null (no ausente). Diferencia observable en JSON schema. | El AC es correcto. Implementar como `format_compliance_pct: null, // WAS-202`. |
| 5 | GAP de breaking change | MEDIA | Añadir `performance_score` y `reputation_score` al response es additive (no breaking). Pero cambiar `erc8004_score` de `null` a un valor real puede romper consumers que interpretan `null` como "no implementado". ¿Hay consumers del endpoint además del UI? | AC nuevo: Añadir `erc8004_score_note: "votes-based, not operational"` para diferenciar semánticamente de `score` (operacional). |
| 6 | GAP de contrato | BAJA | No hay AC sobre la respuesta cuando `reputation_score = null` (agente sin votos). AC2 dice "null si sin votos" pero no especifica si `erc8004_score` también debe ser null en ese caso. | AC3 debe incluir: "WHEN `reputation_score` es null, `erc8004_score` SHALL ser null". |
| 7 | GAP de schema | BAJA | No hay AC sobre documentar el response schema (OpenAPI/JSDoc). Con 4 gaps llenados, el endpoint crece en complejidad y debería tener schema explícito. | Fuera del sprint pero documentar. |

### Veredicto: NECESITA CAMBIOS

**Bloqueante:** Gap #3 (fórmula de normalización no especificada para `erc8004_score` — implementaciones distintas son válidas con el AC actual).

---

## WAS-187 — discoverAgent rankea por performance_score

### Análisis de código actual

`agent-discovery.ts`:
- SELECT incluye `reputation_score` pero NO `performance_score`
- `.order('reputation_score', { ascending: false, nullsFirst: false })` seguido de `.order('price_per_call', { ascending: true })`
- Filtro `constraints.min_reputation` aplica sobre `reputation_score`
- No hay `receipt` en el return — retorna `DiscoveredAgent | null` directamente

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP funcional | ALTA | `performance_score` no está en el SELECT. Sin añadirlo, el ORDER BY en Supabase fallará o no ordenará correctamente. | AC0 (prerequisito): el SELECT SHALL incluir `performance_score`. |
| 2 | GAP de implementación | ALTA | AC1 triple-sort requiere dos llamadas `.order()` + una tercera. Supabase PostgREST soporta múltiples `.order()` encadenados. El AC está bien especificado pero no menciona la consideración de Supabase vs SQL raw. | OK, el AC es implementable directamente. |
| 3 | GAP de especificación | ALTA | AC4 menciona `resolved_slug` en `receipt`. El código NO tiene concepto de `receipt` — retorna `DiscoveredAgent | null`. El caller (presumiblemente `compose/route.ts` o similar) construye el receipt. El AC apunta al lugar equivocado. | AC4: cambiar scope a "WHEN `discoverAgent` retorna un agente, THE caller SHALL incluir `resolved_slug: agent.slug` en el receipt de invocación". O mover el AC al issue que cubre compose/route. |
| 4 | GAP de edge case | MEDIA | AC3 (fallback cuando todos `performance_score = null`): `NULLS LAST` en Supabase `.order('performance_score', { nullsFirst: false })` ya pone nulls al final, pero si TODOS son null, el orden efectivo es solo `reputation_score`. Esto podría satisfacer el AC3 implícitamente. Sin embargo, el AC dice "SHALL ordenar por `reputation_score DESC`" sin especificar si el tercer criterio (`price_per_call ASC`) también aplica en el fallback. | AC3: clarificar "el fallback aplica el orden completo: `reputation_score DESC NULLS LAST`, luego `price_per_call ASC`". |
| 5 | GAP de filtro | MEDIA | AC2: `constraints.min_reputation` debe filtrar `performance_score`. Pero el nombre del parámetro (`min_reputation`) es semánticamente incorrecto si filtra performance. ¿Se renombra el parámetro de la interfaz `DiscoveryConstraints`? Cambiar el nombre es breaking para todos los callers. | AC2: añadir decisión explícita: "el campo `min_reputation` en `DiscoveryConstraints` MANTIENE su nombre (backward compat) pero filtra `performance_score`. Añadir comentario JSDoc indicando el cambio semántico." |
| 6 | GAP de scope filter | MEDIA | El scope filter (`isAgentInScope`) aplica DESPUÉS de la query DB con `.limit(10)`. Si los 10 primeros candidatos son fuera de scope, se retorna null aunque haya agentes válidos fuera del top-10. Este bug pre-existente no es abordado por WAS-187. | Fuera del scope del issue pero documentar como deuda técnica. |
| 7 | GAP de test | BAJA | No hay AC de comportamiento observable cuando `min_reputation` es, por ejemplo, 80 y todos los agentes con `performance_score >= 80` tienen score null. ¿Retorna null o los incluye? | AC5 (nuevo): WHEN `constraints.min_reputation` está definido y todos los agentes tienen `performance_score = null`, THE `discoverAgent` SHALL retornar null (ningún agente cumple el filtro mínimo). |

### Veredicto: NECESITA CAMBIOS

**Bloqueante:** Gap #1 (performance_score ausente del SELECT), Gap #3 (receipt no existe en discoverAgent — AC apunta al componente equivocado), Gap #5 (decisión de backward compat no documentada).

---

## Resumen

| Issue | Veredicto | Bloqueantes |
|-------|-----------|-------------|
| F-02 | NECESITA CAMBIOS | AC3 no implementado (fetch via IP resuelta); nomenclatura `dns_rebinding_blocked` vs `ssrf_blocked` inconsistente |
| F-03 | NECESITA CAMBIOS (minor) | Comentario `SECURITY_NOTE` ausente en código actual |
| WAS-191 | NECESITA CAMBIOS | Fuente de datos de `performance_score` no confirmada; ubicación del badge no especificada |
| WAS-199 | NECESITA CAMBIOS | Fórmula de normalización de `erc8004_score` no especificada |
| WAS-187 | NECESITA CAMBIOS | `performance_score` ausente del SELECT; AC4 apunta a `receipt` que no existe en `discoverAgent`; decisión de renaming/backward compat sin documentar |

### Priorización de fixes de requirements

1. **F-02 → AC3** (el fetch via IP es el fix real del vector; sin esto el fix de seguridad es parcial)
2. **WAS-187 → AC4** (mover el AC al componente correcto antes de implementar)
3. **WAS-187 → AC2** (documentar la decisión de naming en la interfaz)
4. **WAS-199 → AC3** (fórmula de normalización explícita)
5. **WAS-191 → layout/datasource** (confirmar que getModelBySlug incluye performance_score)
6. **F-03** (fix de 5 minutos — solo añadir el comentario)
