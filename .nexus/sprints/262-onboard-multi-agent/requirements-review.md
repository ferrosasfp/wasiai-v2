# Requirements Review — WAS-259: Onboarding múltiples agentes bajo el mismo creator

**Reviewer:** Requirements Reviewer (NexusAgil v1.3)  
**Fecha:** 2026-03-20  
**Work Item:** #262 / Sprint 262

---

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | 🔴 Gap crítico — Seguridad | CRÍTICA | **ROLLBACK CATASTRÓFICO:** El código actual tiene `await serviceClient.auth.admin.deleteUser(userData.user.id)` como compensación si el agent insert falla. Con el nuevo flujo, para un email ya existente, `user.id` es el de un usuario real. Si el agent insert falla, el rollback **borraría la cuenta del creator original** con todos sus agentes. El WI no menciona esto ni tiene AC de protección. | AC-NEW-1 |
| F2 | 🔴 Gap crítico — Seguridad | CRÍTICA | **Account takeover sin autenticación:** El wizard tiene zero auth. Cualquier actor malicioso que conozca el email de un creator puede registrar agentes bajo su cuenta sin restricción. El WI menciona el riesgo en prosa pero AC7 solo dice "Security Reviewer SHALL evaluate" — esto es un proceso, no una mitigación. No hay AC que describa ni la mitigación mínima aceptable ni el flujo de confirmación alternativo. El veredicto de seguridad queda en el limbo. | AC-NEW-2 |
| F3 | 🔴 Gap crítico — Seguridad | ALTA | **Sin límite de agentes por creator:** No hay AC que limite cuántos agentes puede registrar un creator (especialmente vía wizard). Un atacante puede crear N agentes bajo la cuenta de alguien más en loop. El rate limit en `start/route.ts` es 5/hour por IP pero se puede bypassear con IPs distintas. | AC-NEW-3 |
| F4 | 🟠 Gap funcional | ALTA | **Colisión de nombre en `agent_keys`:** El código actual inserta `{ name: 'wizard-agent' }` en la tabla `agent_keys`. Si el mismo user ya tiene una key llamada 'wizard-agent' (de su primer agente), ¿hay unique constraint en `(owner_id, name)`? Si lo hay → insert falla silenciosamente. Si no lo hay → usuario tiene 2 keys con mismo nombre, confuso. El WI no especifica el nombre de la nueva key. | AC-NEW-4 |
| F5 | 🟠 Gap funcional | MEDIA | **Lookup de user por email:** El WI propone `serviceClient.auth.admin.listUsers()` que es paginado y potencialmente lento/timeout con muchos users. No hay AC que especifique el método de lookup (RPC vs query directa a `auth.users`). Si se usa `listUsers()` sin filtro → O(n) scan. | AC-NEW-5 |
| F6 | 🟠 Gap funcional | MEDIA | **AC1 mal redactado (negativo):** "SHALL NOT return 409" dice qué no hacer, no qué hacer. No es testeable positivamente. Falta: "WHEN email already exists, SHALL return 201 with `agent_key`, `slug`, `status: active`". | AC mejorar AC1 |
| F7 | 🟠 Gap funcional | MEDIA | **Sin AC para error en lookup:** WHEN email exists but the user lookup fails (Supabase error), no hay AC que defina el comportamiento esperado. ¿Retorna 500? ¿Mensaje específico? QA no puede probar este path. | AC-NEW-6 |
| F8 | 🟠 Gap funcional | MEDIA | **Edge case — user en auth pero sin agentes previos:** Si el email existe en auth (creado por otro flujo, no wizard), el WI asume que se puede asociar directamente. No hay AC que cubra este escenario ni que valide que el user preexistente es compatible (e.g., `is_active`, no está baneado). | AC-NEW-7 |
| F9 | 🟡 Gap menor | BAJA | **AC3 ambiguo:** "SHALL generate new API key for existing user" — ¿la key es para el usuario o para el agente? ¿Se asocia a `owner_id = user.id`? ¿Con qué nombre? ¿Cuál es el propósito semántico (acceso al nuevo agente, o acceso a todos los agentes del user)? Falta claridad. | AC mejorar AC3 |
| F10 | 🟡 Gap menor | BAJA | **AC7 no es un AC testeable:** "Security Reviewer SHALL evaluate..." es un gate de proceso, no un criterio de aceptación funcional. Debe moverse a dependencias/precondiciones del WI, no estar entre los ACs. | Mover a dependencias |
| F11 | ℹ️ Info | INFO | El WI no especifica si el response al caller debe indicar que se usó una cuenta existente vs nueva. Actualmente el response es idéntico para ambos casos (agent_key, slug, etc.). ¿Intencional? Si es intencional, documentarlo explícitamente para evitar que un implementador "ayude" al caller indicando si el email ya existía (information disclosure). | Clarificación |

---

### ACs sugeridos (agregar)

**AC-NEW-1 — Rollback seguro para user existente:**
> WHEN email already exists AND agent insert fails, SHALL rollback ONLY the newly created API key (by `key_hash`). SHALL NOT delete the existing user. SHALL return 500 with error "Failed to register agent. Please try again."

**AC-NEW-2 — Mitigación de account takeover (BLOQUEANTE hasta Security Review):**
> Opciones (el Security Reviewer debe elegir una):
> - **Opción A (strict):** WHEN email already exists, SHALL send a confirmation email (magic link) to the existing creator. The new agent SHALL only be registered AFTER the creator confirms via the link.
> - **Opción B (permissive+audit):** WHEN email already exists, SHALL register the agent directly BUT SHALL log a security audit event `{ event: 'wizard_email_reuse', email, ip, agent_name, timestamp }` for manual review. SHALL add rate limit: max 3 agents per email per 24h via wizard.
> - **Opción C (block):** WHEN email already exists, SHALL reject with 409 and message "This email already has agents. Use the dashboard to add more." (no change from current, documented as intentional).

**AC-NEW-3 — Límite de agentes por creator via wizard:**
> WHEN email already exists, SHALL check count of agents with `creator_id = existing_user.id`. IF count >= [MAX_WIZARD_AGENTS, e.g. 10], SHALL reject with 429 and error "Maximum number of agents reached for this account. Use the dashboard."

**AC-NEW-4 — Nombre único para API key nueva:**
> WHEN generating a new API key for an existing user, the key name SHALL be `wizard-agent-{timestamp}` or `wizard-agent-{agent_slug}` to avoid collision with existing keys. SHALL NOT use the static name 'wizard-agent'.

**AC-NEW-5 — Método de lookup de user existente:**
> WHEN email already exists, SHALL look up the existing user via `serviceClient.from('auth.users').select('id').eq('email', answer)` (single indexed query) rather than `listUsers()` (full scan). SHALL return 500 if the lookup query fails.

**AC-NEW-6 — Error en lookup de user existente:**
> WHEN email already exists AND user lookup returns a DB error, SHALL return 500 with error "Failed to retrieve existing account. Please try again."

**AC-NEW-7 — User preexistente de otro flujo:**
> WHEN email already exists in auth AND the user was created via a non-wizard flow, SHALL still associate the new agent to that user.id (same behavior). No special handling required.

---

### ACs existentes — mejoras de redacción

**AC1 mejorado:**
> WHEN email already exists in Supabase Auth, SHALL return 201 with fields: `agent_key` (new key), `slug` (new agent slug), `status: "active"`, `agent_url`, `dashboard_url`. Response SHALL be structurally identical to the new-user flow (no disclosure of whether email was pre-existing).

**AC3 mejorado:**
> WHEN email already exists, SHALL insert a new row in `agent_keys` with `owner_id = existing_user.id` and `name = 'wizard-agent-{agent_slug}'`. SHALL return the raw key to the caller. SHALL NOT reuse or expose existing keys.

---

### Veredicto

**NECESITA CAMBIOS**

Dos gaps críticos bloquean el merge:

1. **F1 — Rollback catastrófico:** Sin AC-NEW-1, el código actual borraría la cuenta del creator original si el agent insert falla. Esto es un bug de destrucción de datos garantizada en el error path. El implementador debe proteger explícitamente el rollback para no tocar el user existente.

2. **F2 — Account takeover sin mitigación definida:** El WI reconoce el riesgo pero no lo resuelve. AC7 ("Security Reviewer SHALL evaluate") no puede ser un AC de la misma historia — debe resolverse ANTES de que esta historia pase a Spec. La decisión de opción A/B/C debe estar documentada en el WI como prerrequisito.

Los gaps F3-F8 deben resolverse antes de que QA pueda generar suite de pruebas completa.
