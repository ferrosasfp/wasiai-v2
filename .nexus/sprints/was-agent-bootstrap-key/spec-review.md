# Spec Review — SDD #093 (WAS-271)

> Reviewer: Spec Reviewer (NexusAgile v1.3)
> Fecha: 2026-03-21
> Rama: feature/093-agent-bootstrap-key

---

## Wave 0 — Pre-flight

| Check | Status | Detalle |
|-------|--------|---------|
| ¿Fix ya existe en codebase? | ✅ No existe | `bootstrapAnonymousCreator` no está implementado; `ProbeStatus` no incluye `'draft'` |
| ¿`src/app/api/v1/agents/register/route.ts` existe? | ✅ Existe | Leído completo |
| ¿`src/lib/agents/health-probe.ts` existe? | ✅ Existe | Leído completo |
| ¿`supabase/migrations/00000000000003_wasiai_core.sql` existe? | ✅ Existe | Leído creator_profiles y agent_keys DDL |
| ¿`resolveCreatorFromEmail` existe con firma correcta? | ✅ Existe | `async function resolveCreatorFromEmail(serviceClient, email): Promise<string \| null>` — patrón correcto para ejemplar |
| ¿`generateApiKey` importado en register/route.ts? | ✅ Importado | línea: `import { generateApiKey } from '@/features/agent-api/services/agent-keys.service'` |
| ¿`randomBytes` importado en register/route.ts? | ✅ Importado | línea: `import { createHash, randomBytes } from 'crypto'` |
| ¿`serviceClient.auth.admin.createUser` tiene permisos? | ✅ Sí | `resolveCreatorFromEmail` ya lo usa exitosamente con `createServiceClient()` (SERVICE_ROLE key) |
| ¿`crypto.randomUUID()` disponible sin import? | ✅ Sí | Node.js 18+ / Next.js runtime: disponible como global Web Crypto API. No requiere import. |
| ¿`ProbeStatus` en health-probe.ts es `'active' \| 'reviewing'`? | ✅ Confirmado | línea 9: `type ProbeStatus = 'active' \| 'reviewing'` — extensión a `'draft'` es necesaria |
| ¿`updateAgentHealth` firma correcta? | ✅ Correcta | `(serviceClient, agentId: string, status: ProbeStatus, healthCheck: HealthCheckResult): Promise<void>` |
| ¿FK `agents.creator_id` tiene CASCADE? | ⚠️ SET NULL | `042_agents_creator_profiles_fk.sql`: `FK creator_profiles(id) ON DELETE SET NULL` — ver Finding #1 |
| ¿`creator_profiles.id` tiene CASCADE a auth.users? | ✅ CASCADE | `ON DELETE CASCADE` — deleteUser → creator_profile eliminado automáticamente |

---

## Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| 1 | 🔴 HIGH | **`isBootstrap` no declarado — TypeScript compile error (AC8).** El SDD muestra `isBootstrap = true` en el flujo (sección 4.3) pero NUNCA declara `let isBootstrap = false` al inicio del handler. El Builder copiará el pseudocódigo y obtendrá `Cannot find name 'isBootstrap'`. Añadir `let isBootstrap = false` junto a `let creatorId: string \| null = null` y `let authMethod: string = 'open'`. | `register/route.ts` — handler body (~línea 130, donde se declaran las variables del handler) |
| 2 | 🟡 MEDIUM | **Conflicto de clave `management_key_warning` en objeto de respuesta.** El objeto return ya tiene `management_key_warning: managementKey ? null : '...'` (hardcoded). El SDD propone añadir `...(isBootstrap && managementKey && { management_key_warning: '...bootstrap...', next_steps: {...} })`. Si el spread se coloca ANTES de la línea existente, el valor bootstrap es sobreescrito por el null/string existente. El SDD no especifica el orden relativo. Si el Builder no pone el spread DESPUÉS de la key existente, bootstrap warning nunca se muestra. Necesita aclarar orden explícito: eliminar la línea existente o ubicar el spread como última entrada del objeto. | `register/route.ts` — sección return final |
| 3 | 🟡 MEDIUM | **Rollback management_key: `deleteUser` NO borra el agente vía CASCADE — solo SET NULL.** La cadena real es: `deleteUser` → `creator_profiles` CASCADE eliminado → `agents.creator_id` **SET NULL** (no eliminado). El SDD sí incluye `await serviceClient.from('agents').delete().eq('id', agent.id)` como best-effort — eso es correcto. Pero el comentario `// También eliminar el agente creado (best-effort)` puede inducir al Builder a pensar que es opcional. Debe ser explícito que sin esta línea el agente queda huérfano con `creator_id = null`. | SDD sección 4.3 rollback / `042_agents_creator_profiles_fk.sql:8-10` |
| 4 | 🟡 MEDIUM | **`@bootstrap.wasiai.internal` — dominio interno no validado contra Supabase.** El SDD lo lista como riesgo (sección 7) con mitigación "verificar en Wave 0", pero Wave 0 del Builder (sección 8) lo marca como `[ ] W0.4: Verificar que auth.admin.createUser acepta email con dominio @bootstrap.wasiai.internal`. No hay evidencia en el codebase de que esto haya sido probado. Supabase Auth en producción con SMTP configurado puede rechazar emails no-RFC si hay un email provider hook. Si falla, `bootstrapAnonymousCreator` retorna `null` y el endpoint devuelve 503 en cada registro open. Sugerencia: usar formato `agent+{uuid}@bootstrap.internal` o documentar que en dev se debe deshabilitar email validation. | SDD sección 7 riesgos |
| 5 | 🟢 LOW | **`updateAgentHealth` con `'draft'` — callers existentes no se rompen.** Todos los call-sites en health-probe.ts usan `'active'` o `'reviewing'`. Extender el union type a `\| 'draft'` es backwards-compatible. Sin embargo, hay 2 sitios en el archivo que pasan `'reviewing'` en error handler de DNS rebinding (líneas ~38 y ~47) que NO cambia la SDD — están correctamente dejados como `'reviewing'`. Confirmar que esos dos sitios son intencionales (DNS rebinding → reviewing, no draft). | `src/lib/agents/health-probe.ts` líneas ~38, ~47 |

---

## Veredicto

**SPEC_APPROVED: no**

**Razones bloqueantes:**

1. **Finding #1 (HIGH):** `isBootstrap` no declarado → TypeScript compile error garantizado. Viola AC8 (tsc limpio). Fix trivial pero obligatorio antes de dar al Builder.

2. **Finding #2 (MEDIUM):** Colisión de `management_key_warning` en el objeto return → AC3 silently broken si el Builder no sabe el orden correcto. El SDD debe especificar explícitamente que la línea existente `management_key_warning: managementKey ? null : '...'` se reemplaza (no se complementa) con el spread condicional, o dar el objeto return completo.

**Correcciones mínimas requeridas antes de Builder:**

```typescript
// 1. En handler body, junto a las otras declaraciones de variables:
let isBootstrap = false

// 2. En el return final, REEMPLAZAR la línea existente:
//   management_key_warning: managementKey ? null : '...',
// POR:
management_key: managementKey,
management_key_warning: isBootstrap && managementKey
  ? 'Store this key securely. It will NOT be shown again. Recovery: POST /api/v1/agents/{slug}/recover (coming soon).'
  : managementKey ? null : 'Management key could not be issued. Contact support@wasiai.io',
...(isBootstrap && managementKey && {
  next_steps: {
    publish_another_agent: 'POST /api/v1/agents/register with header x-agent-key: ' + managementKey,
    update_this_agent: `PATCH /api/v1/agents/${data.slug} with header x-agent-key: <your_key>`,
    docs: 'https://wasiai.io/docs/agents/management-key',
  },
}),
```

Los Findings #3, #4, #5 son informativos y no bloquean, pero deben ser conocidos por el Builder.
