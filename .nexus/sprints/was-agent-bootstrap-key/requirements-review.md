## Requirements Review — WAS-AGENT-BOOTSTRAP-KEY

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | CONFLICTO | ALTA | AC6 contradice el código actual: `health-probe.ts` mapea todos los no-2xx (incluidos 4xx **y** 5xx) a `'reviewing'`. AC6 exige split: 4xx→`reviewing`, 5xx/timeout/DNS→`draft`. Además, el tipo `ProbeStatus = 'active' | 'reviewing'` no incluye `'draft'` — el código no compilaría sin cambiar el tipo. | AC6 debe incluir: "THEN type ProbeStatus SHALL incluir 'draft'" |
| 2 | FALTA | ALTA | Sin AC de dependencia de esquema/migración. AC5 crea `creator_profiles` con `username` y `display_name`, pero si la tabla tiene columnas NOT NULL adicionales (ej. `bio`, `avatar_url` con default null) el insert falla silenciosamente. No hay AC que valide contra el esquema real de la tabla. | AC-NEW-A: WHEN se va a insertar creator_profile anónimo, THEN el payload SHALL satisfacer todas las columnas NOT NULL de `creator_profiles` sin valores en runtime. |
| 3 | FALTA | ALTA | Ambigüedad de path: `authMethod === 'open'` con `creator_email` presente actualmente toma el path `resolveCreatorFromEmail()` (crea/reutiliza un auth user real). El nuevo AC1 introduce un path distinto (creator anónimo sin email). El WI no especifica cuál tiene prioridad ni si `creator_email` queda deprecado para `authMethod === 'open'`. El código actual y el nuevo AC1 colisionan. | Agregar a AC1: "si `creator_email` está presente en la request, `creator_email` SHALL tener prioridad sobre el path anónimo". O alternativamente definir explícitamente que `creator_email` queda ignorado para `authMethod === 'open'` post-fix. |
| 4 | FALTA | MEDIA | Sin AC de atomicidad. Si el `INSERT` de `creator_profile` tiene éxito pero el `INSERT` de `agent` falla (ej. constraint race condition en slug), el `creator_profile` anónimo queda huérfano sin ningún agente asociado. No hay AC de rollback ni cleanup. | AC-NEW-B: WHEN la inserción del agente falla después de crear el creator_profile anónimo, THEN SHALL no retornar 201. El creator_profile huérfano es aceptable (ON CONFLICT DO NOTHING protege reinserciones), pero la respuesta SHALL ser 500/409 según el error. |
| 5 | FALTA | MEDIA | Sin AC de rate-limit para creación de perfiles anónimos. El path `authMethod === 'open'` sin email crea un nuevo `creator_profile` en cada llamada exitosa. Un actor malicioso puede inflar la tabla `creator_profiles` con perfiles basura incluso si el rate-limit de registro existe. El rate-limit actual se aplica post-validación y post-slug-check, pero antes de la creación del perfil. | AC-NEW-C: WHEN se crea creator_profile anónimo, el rate-limit SHALL ser aplicado antes de la creación del perfil (mover check de RL antes del bloque de creación anónima). |
| 6 | FALTA | MEDIA | Formato de `management_key` no especificado en ACs. AC1 menciona "wasi_xxx" pero `generateApiKey()` puede emitir cualquier formato. Ningún AC verifica el prefijo `wasi_`. Si el formato cambia, los tests pasarán sin detectar la regresión. | AC-NEW-D: WHEN se emite management_key, THEN SHALL tener formato `wasi_[a-zA-Z0-9]{32,}`. |
| 7 | FALTA | BAJA | AC5 usa `ON CONFLICT (id) DO NOTHING` pero `username` tiene constraint UNIQUE en la tabla. Con `agent_<uuid_corto>` la colisión es improbable, pero si ocurre el insert falla silenciosamente (DO NOTHING) y se devuelve la key sin `creator_id` real. No hay manejo de este edge case. | Agregar a AC5: "WHEN username ya existe por colisión, SHALL reintentar con uuid_corto diferente o fallar con 500." |
| 8 | FALTA | BAJA | AC3 define `next_steps` en la respuesta pero no especifica estructura exacta (array de strings, objeto con keys, etc.). Los ACs de contrato de respuesta deben ser unívocos para evitar ambigüedad entre implementación y test. | Agregar a AC3: "next_steps SHALL ser un array de strings con al menos 3 elementos: [cómo usar la key, cómo hacer PATCH, URL de docs]." |
| 9 | YA IMPLEMENTADO | INFO | AC2 (x-agent-key) está completamente implementado en el código actual. No requiere cambios. | — |
| 10 | YA IMPLEMENTADO | INFO | AC4 (jwt/agent_key sin breaking changes) está implementado. El flujo JWT sigue intacto. | — |
| 11 | YA IMPLEMENTADO | INFO | AC7 (409 cuando slug existe) ya funciona: el check de slug ocurre antes de cualquier creación de perfil, por lo que el invariante "NO SHALL crear creator_profile" se cumple naturalmente con la nueva implementación siempre que el bloque de creación anónima quede después del slug-check. | — |

---

### ACs sugeridos (agregar al Work Item)

**AC-NEW-A — Compatibilidad de esquema de creator_profile**
> WHEN se inserta creator_profile anónimo, THEN el payload SHALL incluir únicamente las columnas `id`, `username`, `display_name` (y opcionalmente las demás con sus defaults). SHALL verificarse contra la DDL actual de `creator_profiles` antes de implementar.

**AC-NEW-B — Manejo de fallo post-creación de perfil**
> WHEN la inserción del agente falla después de que el creator_profile anónimo fue creado, THEN la respuesta SHALL ser 500 (error genérico) o 409 (slug duplicado). NO SHALL retornar 201 con creator_profile huérfano.

**AC-NEW-C — Rate-limit aplicado antes de creación de perfil anónimo**
> WHEN authMethod === 'open' y la lógica va a crear un creator_profile anónimo, THEN el rate-limit global SHALL haberse verificado antes de ejecutar el INSERT del perfil.

**AC-NEW-D — Formato de management_key**
> WHEN se emite management_key, THEN SHALL matchear el patrón `wasi_[a-zA-Z0-9_-]{32,}`.

**Corrección crítica a AC6:**
> AC6 actual: "WHEN probeEndpoint recibe HTTP 4xx, THEN agente SHALL mantenerse en status 'reviewing'. Solo 5xx/timeout/DNS → 'draft'."
>
> Añadir: "THEN `ProbeStatus` type en `health-probe.ts` SHALL extenderse a `'active' | 'reviewing' | 'draft'`. WHEN status es 'draft', `updateAgentHealth` SHALL aceptar ese valor sin error de tipos."

---

### Análisis de Scope

- **Scope IN correcto**: ambos archivos afectados están listados.
- **Scope ambiguo**: AC6 modifica el comportamiento del probe (actualmente `ProbeStatus` no incluye `'draft'`). Este cambio de tipo puede afectar otras partes del código que consuman `ProbeStatus`. No se menciona verificar usos del tipo fuera de `health-probe.ts`.
- **Scope OUT apropiado**: la exclusión de recuperación de key, KYC, y wallet-based identity es correcta y no hay fugas de scope en los ACs.
- **Dependencia no declarada**: `creator_profiles` table DDL (migración o verificación de esquema). Si hay columnas NOT NULL sin default que no están en el payload del AC5, el sprint bloqueará en runtime.

---

### Veredicto

**NECESITA CAMBIOS**

Bloqueantes antes de poder implementar:
1. **AC6** — el tipo `ProbeStatus` no incluye `'draft'`; el AC debe explicitarlo para que AC8 (tsc) pase.
2. **Colisión con `creator_email` path** (finding #3) — sin aclarar, el desarrollador tendrá que decidir en implementación, creando comportamiento no especificado.
3. **Dependencia de esquema** (finding #2) — sin verificar DDL de `creator_profiles`, el insert anónimo puede fallar silenciosamente en producción.

Los demás findings son mejoras de calidad que reducen riesgo pero no son hard-blockers para empezar la implementación.
