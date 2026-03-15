# Build Report — WAS-210

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `src/features/docs/content/errors.tsx` | Añadido `input_invalid` (422), convertido a `'use client'` + `useTranslations('docs')`, textos de UI externalizados |
| `src/features/docs/content/agent-keys.tsx` | Corregido header `X-API-Key` → `x-agent-key`, prefix `wai_` → `wasi_`, añadida sección "Key scoping" con `allowed_slugs`/`allowed_categories`, convertido a `'use client'` + `useTranslations('docs')` |
| `src/features/docs/content/api-reference.tsx` | Añadido `'use client'`, documentado GET `/agents/:slug` con `sandbox_enabled` y `performance_score`, actualizado POST `/invoke` con validación `input_invalid` pre-pago |
| `src/features/docs/content/discovery.tsx` | Corregido `min_reputation` a escala `0–100`, convertido a `'use client'` + `useTranslations('docs')` con claves `discoveryContent.*` |
| `src/features/docs/components/DocsSidebar.tsx` | Reordenado: Discovery sube antes de Advanced |
| `messages/en.json` | Añadidas claves `errorsContent.*`, `agentKeysContent.*`, `discoveryContent.*` |
| `messages/es.json` | Añadidas claves `errorsContent.*`, `agentKeysContent.*`, `discoveryContent.*` |

## i18n keys añadidas

| Key | EN | ES |
|-----|----|----|
| `docs.errorsContent.title` | Errors | Errores |
| `docs.errorsContent.description` | All errors return a JSON body... | Todos los errores devuelven... |
| `docs.errorsContent.colStatus` | Status | Estado |
| `docs.errorsContent.colCode` | Code | Código |
| `docs.errorsContent.colDescription` | Description | Descripción |
| `docs.errorsContent.colSolution` | Solution | Solución |
| `docs.errorsContent.exampleTitle` | Example error response | Ejemplo de respuesta de error |
| `docs.agentKeysContent.title` | Agent Keys | Agent Keys |
| `docs.agentKeysContent.description` | Agent Keys are authentication... | Las Agent Keys son credenciales... |
| `docs.agentKeysContent.createTitle` | Create an Agent Key | Crear una Agent Key |
| `docs.agentKeysContent.useTitle` | Use the key | Usar la key |
| `docs.agentKeysContent.useDescription` | Include the header x-agent-key... | Incluye el header x-agent-key... |
| `docs.agentKeysContent.balanceTitle` | Check balance | Consultar balance |
| `docs.agentKeysContent.scopingTitle` | Key scoping | Scoping de keys |
| `docs.agentKeysContent.scopingDescription` | Restrict a key to specific agents... | Restringe una key a agentes... |
| `docs.agentKeysContent.scopingNote` | Scoped keys are ideal... | Las keys con scope son ideales... |
| `docs.agentKeysContent.fundTitle` | Fund on-chain | Fondear on-chain |
| `docs.agentKeysContent.fundDescription` | To deposit USDC... | Para depositar USDC... |
| `docs.agentKeysContent.fundSuffix` | . The dashboard automatically... | . El dashboard gestiona... |
| `docs.agentKeysContent.limitsTitle` | Limits & lifecycle | Límites y ciclo de vida |
| `docs.agentKeysContent.limit1-4` | (4 limit items) | (4 items en ES) |
| `docs.discoveryContent.title` | Agent Discovery | Descubrimiento de Agentes |
| `docs.discoveryContent.queryMinReputationDesc` | Minimum performance score 0–100... | Score de rendimiento mínimo 0–100... |
| `docs.discoveryContent.*` | (full set of query/field descriptions) | (traducido al ES) |

## Build

- tsc: **PASS**
- build: **PASS**

## Commit

- Hash: `a8193b0d4`
- Message: `docs(WAS-210): actualizar docs + i18n`
