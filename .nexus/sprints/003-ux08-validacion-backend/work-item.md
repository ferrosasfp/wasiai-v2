# Work Item #003 — UX-08: Validación backend Zod en /api/models

| Campo | Valor |
|-------|-------|
| **#** | 003 |
| **Linear** | WAS-08 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Objetivo** | Agregar validación Zod en POST /api/models para que ningún agente malformado llegue a la DB. El frontend ya tiene validación parcial pero el backend acepta cualquier payload. |
| **Reglas de negocio** | name: min 3, max 80. description: min 10, max 1000. endpoint_url: URL HTTPS válida. price_usdc: número > 0, max 100. slug: alfanumérico + guiones, único. category: enum ['nlp','vision','audio','code','multimodal','defi-risk']. Fallo → 422 con `errors: [{field, message}]`. Solo validación en handler — no migration. |
| **Scope IN** | POST /api/models route handler. Schema Zod exportable. Respuesta 422 estructurada. |
| **Scope OUT** | Frontend PublishForm.tsx. PUT/PATCH. Otros endpoints. |

## Acceptance Criteria

| # | AC |
|---|---|
| 1 | WHEN se envía name vacío o <3 chars, THE API SHALL responder 422 con error en campo "name" |
| 2 | WHEN se envía endpoint_url sin HTTPS, THE API SHALL responder 422 con error en campo "endpoint_url" |
| 3 | WHEN se envía price_usdc ≤ 0, THE API SHALL responder 422 con error en campo "price_usdc" |
| 4 | WHEN se envía category fuera del enum permitido, THE API SHALL responder 422 con error en campo "category" |
| 5 | WHEN el payload es válido, THE API SHALL procesar normalmente sin cambio de comportamiento |
| 6 | IF validación falla, THEN THE response SHALL incluir `errors: [{field: string, message: string}]` |
