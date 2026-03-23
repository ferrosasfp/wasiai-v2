# Spec Review — MGMT-KEY A2A

_Reviewer: Spec Reviewer (NexusAgile) | Date: 2026-03-21_

---

## Wave 0 Results

- **W0.1:** ✅
  - `let creatorId: string | null = null` → `route.ts:94`
  - `body = await request.json()` → `route.ts:155`
  - `if (creatorId)` (management key block) → `route.ts:289`
  - `randomBytes` importado → `route.ts:35` (`import { createHash, randomBytes } from 'crypto'`)

- **W0.2:** ✅
  - `listUsers` encontrado en `src/app/api/v1/onboard/step/route.ts:287`
  - Patrón exacto: `await serviceClient.auth.admin.listUsers({ perPage: 1000 })`
  - Mismo patrón que propone el SDD en Wave 2a → compila

- **W0.3:** ✅
  - `createServiceClient()` retorna `createSupabaseClient(url, SUPABASE_SERVICE_ROLE_KEY)` (supabase-js estándar con service_role) → `auth.admin` disponible y funcional
  - `upsert({ ... }, { onConflict: 'id' })` es sintaxis supabase-js válida, no tiene restricciones de tipo que impidan compilar

- **W0.4:** ✅
  - Campo `creator_email` **no existe** en `RegisterAgentSchema` actual
  - Campos opcionales existentes: `description`, `agent_type`, `dependencies`, `creator_wallet`, `erc8004_identity`, `capabilities`, `mcp_tool_name`, `mcp_description`, `framework`, `version`, `register_on_chain`, `input_schema`, `output_schema`, `tags`
  - Ningún campo se llama `creator_email` → sin colisión

- **W0.5:** ✅
  - `return NextResponse.json({...})` en la línea final no tiene type annotation explícita
  - `creatorId` es `string | null` → serializable como JSON sin error de tipo
  - Añadir `creator_id: creatorId` no rompe nada

---

## Findings

| # | Severity | Issue |
|---|----------|-------|
| 1 | LOW | El SDD menciona `createError?.code === 'user_already_exists'` como posible código de error de Supabase. El código real de Supabase Auth para email duplicado suele ser `email_exists` (ya listado) pero puede variar por versión. El catch-all de `createError?.status === 422` mitiga, pero sería bueno loggear el `createError.code` exacto en el primer deploy para afinar. No bloquea build. |
| 2 | LOW | `listUsers({ perPage: 1000 })` no pagina. Si el workspace tiene >1000 usuarios, `find()` podría no encontrar el email. Para MVP con pocos usuarios es aceptable, pero dejar un `// TODO: paginar si escala` en el código. No bloquea. |
| 3 | INFO | El SDD marca como OBLIGATORIO "randomBytes ya está importado — no re-importar". Confirmado en W0.1 (línea 35). La constraint es válida y el codebase la cumple. |
| 4 | INFO | El campo `creator_id` en el response final (`W0.5`) no está documentado en el SDD como nuevo campo de respuesta, pero AC1/AC2 lo requieren (`respuesta incluye... creator_id`). Añadirlo es correcto. |

---

## Veredicto

**READY TO BUILD**

Todos los checks Wave 0 pasan. El código base tiene los imports, patrones y hooks necesarios. Los findings son LOW/INFO y no bloquean. El SDD es ejecutable tal como está.

Proceder con Wave 1 → Wave 2a → Wave 2b → Wave 2c siguiendo build gates de `tsc --noEmit`.
