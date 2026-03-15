# Requirements Review — WAS-209

> Reviewer: NexusAgil Requirements Bot v1.3
> Fecha: 2026-03-14
> Modo: Gap Analysis (¿qué FALTA?)

---

## Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F-01 | **Schema Gap** | 🔴 BLOCKER | `invoke_url`, `payment.method`, `payment.asset`, `payment.chain`, `payment.contract` no existen como columnas en la tabla `agents`. Scope OUT dice "sin cambios de schema DB" pero la respuesta los requiere. Contradicción imposible de implementar sin migración o columna computed. | AC-5 o Scope IN debe aclarar de dónde vienen estos campos (columnas nuevas, tabla relacionada, o campo JSONB existente). |
| F-02 | **Scale Mismatch** | 🔴 BLOCKER | `reputation_score` en DB es `NUMERIC(5,2)` escala 0–100 (ej: `87.50`). AC-5 exige devolver `0–1` y AC-4 filtra con `min_reputation=0.8`. La normalización (`÷100`) no está especificada en ningún AC, dejando al implementador que la asuma. Un test contra `min_reputation=0.8` pasaría o fallaría según el criterio del dev. | Añadir a AC-4 y AC-5: "reputation_score se normaliza dividiendo el valor DB entre 100 antes de devolver y antes de aplicar filtros". |
| F-03 | **Cursor Opaque** | 🔴 BLOCKER | AC-7 dice "cursor-based" pero no define: (a) qué campo es el cursor (`created_at`? `id`? `slug`?), (b) cómo el cliente lo envía (`?cursor=<valor>`), (c) orden de la paginación (ASC/DESC por qué campo). Sin esto no es testeable ni implementable de forma determinista. | AC-7 debe especificar: campo base del cursor, nombre del query param, orden de resultados, y qué pasa con `?cursor=<inválido>`. |
| F-04 | **`total` con cursor** | 🟠 ALTA | AC-2 muestra `{"agents":[], "total":0}`. Con cursor-based pagination, devolver `total` global requiere `COUNT(*)` adicional (costoso). ¿Es `total` el count de la página o el total global? No está definido y crea expectativas inconsistentes entre ACs. | Aclarar en AC-7: si `total` es del resultado completo (requiere COUNT) o de la página actual. Si es global, aceptarlo explícitamente como cost. |
| F-05 | **Category case-sensitivity** | 🟠 ALTA | AC-2 especifica tag filter como case-insensitive. AC-3 no menciona sensibilidad para `?category=`. ¿`defi` == `DeFi`? Inconsistencia que generará bugs. | AC-3: añadir "(case-insensitive, igual que tags)". |
| F-06 | **Error body sin definir** | 🟡 MEDIA | AC-9 dice `→ 400` pero no define el response body. Los consumidores autónomos necesitan un schema estable para parsear errores. | AC-9: añadir el shape exacto: `{"error": "limit must be between 1 and 100"}` o similar. |
| F-07 | **`?cursor=<inválido>` no cubierto** | 🟡 MEDIA | No hay AC para cursor malformado o expirado. ¿400? ¿Restart desde página 1? Un agente autónomo necesita comportamiento determinista ante cursors stale. | Nuevo AC-10: "`?cursor=<inválido o malformado>` → 400 con mensaje descriptivo". |
| F-08 | **`max_price` — escala sin definir** | 🟡 MEDIA | AC-4 usa `max_price=0.05`. La columna DB es `price_per_call` (sin `_usdc`). ¿El filtro compara directamente contra la columna? ¿Unidad en USDC directamente? Hay renaming implícito (`price_per_call` → `price_per_call_usdc`) que no está documentado. | AC-4 y AC-5: confirmar que `max_price` filtra sobre `price_per_call` del DB y que la unidad es USDC. |
| F-09 | **500 error path sin definir** | 🟡 MEDIA | Ningún AC cubre el comportamiento ante fallo de DB. El código actual devuelve `{error: "Failed to fetch capabilities"}` pero no está contractualizado. Los agentes autónomos necesitan saber qué esperar. | Nuevo AC o Scope IN: definir shape de error 500 y si aplica `Retry-After`. |
| F-10 | **`erc8004.total_invocations` vs `total_calls`** | 🟡 MEDIA | AC-5 exige `erc8004.total_invocations` pero la columna DB se llama `total_calls`. El mapeo no está documentado. | AC-5: anotar "(mapeado desde columna `total_calls` del DB)". |
| F-11 | **Conflicto con WAS-208** | 🟡 MEDIA | El archivo actual implementa WAS-208 con una lógica completamente diferente (extrae campo `capabilities` de agentes, devuelve lista de strings). Sobrescribirlo borra WAS-208 sin referencia a si esa funcionalidad se migra, depreca o mueve. | Scope IN/OUT o dependency: aclarar si WAS-208 queda obsoleto o si `capabilities` endpoint v1 se preserva en otra ruta. |
| F-12 | **`min_reputation` sin upper bound** | 🟢 BAJA | `min_reputation=1.0` devolvería solo agentes con reputación perfecta. ¿Aceptable? ¿Y `min_reputation=1.5`? No hay validación ni AC para valores fuera de rango 0–1. | AC-9 o nuevo AC: validar `min_reputation` y `max_price` con rangos o devolver 400. |
| F-13 | **Ordering no especificado** | 🟢 BAJA | Sin `ORDER BY` definido, resultados no son deterministas entre páginas (especialmente con paginación cursor). | AC-7 o Scope IN: especificar orden (ej: `ORDER BY created_at DESC, slug ASC`). |

---

## Resumen por categoría

| Categoría | Blockers | Altas | Medias | Bajas |
|-----------|----------|-------|--------|-------|
| Schema/DB | 1 (F-01) | — | — | — |
| Lógica de negocio | 1 (F-02) | 1 (F-04) | 1 (F-10) | 1 (F-12) |
| Paginación | 1 (F-03) | — | 1 (F-07) | 1 (F-13) |
| Contratos de API | — | 1 (F-05) | 2 (F-06, F-09) | — |
| Mapping/Naming | — | 1 (F-08) | — | — |
| Dependencias | — | — | 1 (F-11) | — |

---

## Veredicto

### ❌ NECESITA CAMBIOS

**3 blockers impiden comenzar implementación:**

1. **F-01** — Columnas `invoke_url` y `payment.*` no existen en DB. Requiere decisión de arquitectura antes de escribir una línea de código.
2. **F-02** — Escala de `reputation_score` (DB: 0–100 vs API: 0–1) sin normalización contractualizada.
3. **F-03** — Paginación cursor-based sin definir campo, param, ni ordenamiento.

**Acción requerida:** Resolver F-01, F-02, F-03 antes de asignar a desarrollo. F-04, F-05, F-08 deberían resolverse en la misma iteración de refinamiento. El resto puede resolverse inline durante implementación con decisiones documentadas en el PR.
