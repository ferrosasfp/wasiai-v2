# Requirements Review — Free Trial: Sandbox Mode + A2A + Reconciliación

_Reviewer: Requirements Reviewer subagent | 2026-03-23_

---

## Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F-01 | Gap de AC | 🔴 Alta | **`example_output` fallback no tiene AC**. Scope IN lo menciona ("example_output fallback cuando el agente no tiene uno definido") pero ningún AC especifica: qué devuelve sandbox cuando no hay `example_output`, cuál es el fallback (¿string hardcoded? ¿schema-generated?), ni si esto debe fallar o devolver un valor genérico. | Ver AC-6 sugerido |
| F-02 | Gap de migración | 🔴 Alta | **`sandbox_enabled` no existe confirmado en DB**. No hay AC de migración. Si no existe como columna en `agents`, todos los ACs de sandbox fallan. `payment_type: 'sandbox'` tampoco está en `src/lib/validation/payment-type.ts` (referenciado en context-map pero no validado). | Agregar AC de pre-condición de migración |
| F-03 | Comportamiento cambio silencioso | 🔴 Alta | **AC-2 cambia cuándo se consume el trial**. Route C actual solo hace upsert en `result.status === 'success'`. El RPC `use_trial` incrementa ANTES de llamar al upstream (así funciona en `/trial` endpoint). Cambiar a RPC consumiría el trial aunque el upstream falle. Este cambio de comportamiento no está documentado ni decidido en ningún AC. | AC-2 debe especificar explícitamente si trial se consume en fallo de upstream |
| F-04 | Schema conflict | 🔴 Alta | **AC-4 rompe el body schema del `/trial` endpoint**. El endpoint tiene `BodySchema = z.object({ input: z.string().min(1).max(2000) })`. Añadir `sandbox: true` en el body fallaría la validación Zod. No hay AC que mencione actualizar el schema de validación. | AC-4 debe incluir "AND el body schema acepta `sandbox?: boolean`" |
| F-05 | Edge case — autenticación en sandbox | 🟠 Media | **AC-1 no especifica si sandbox requiere autenticación**. Route C ya requiere JWT auth para free trial (`auth_required_for_trial`). ¿Un anónimo puede activar sandbox? ¿O heredar la misma restricción? Ambos paths quedan abiertos. | AC-1 debe incluir el requisito de auth para sandbox |
| F-06 | Edge case — autenticación en AC-4 sandbox | 🟠 Media | **AC-4 no especifica si sandbox en `/trial` funciona para anónimos**. El endpoint permite anónimos con IP rate limit. Si sandbox no requiere upstream, ¿los anónimos tienen acceso ilimitado a sandbox? Abuso posible. | AC-4 debe especificar si el rate limit aplica igual en sandbox o no |
| F-07 | AC inconsistente | 🟠 Media | **AC-1 dice loguear en `agent_calls` con `payment_type: 'sandbox'`** pero `assertPaymentType()` en `src/lib/validation/payment-type.ts` probablemente no tiene ese valor (los tipos conocidos son: `api_key`, `x402`, `free_trial`). Si `assertPaymentType` usa un enum estricto, el log fallará en runtime silenciosamente o lanzará excepción. | Verificar y agregar AC que exija que `payment_type: 'sandbox'` sea un valor válido en el validator |
| F-08 | Edge case — A2A body format | 🟠 Media | **AC-3 no especifica el body format esperado para A2A**. El `/trial` endpoint acepta `{ input: string }` (texto plano). Route C en invoke acepta el body completo del agente. Para A2A via `/models/{slug}/invoke`, ¿qué schema aplica? Sin especificarlo, un agente caller podría enviar `{ input: "..." }` y fallar validación del agente destino. | AC-3 debe especificar que el body es el body nativo del agente (no `{ input }` wrapper) |
| F-09 | Concurrencia | 🟠 Media | **AC-2 resuelve race condition en Route C, pero AC-1 (sandbox) no menciona concurrencia**. Sandbox no decrementa counter, entonces no hay race condition en conteo — pero si sandbox valida permisos con una query a `agents`, dos requests simultáneos con `sandbox_enabled: false` podrían comportarse de forma inconsistente si hay un cache. Menor, pero sin AC que lo excluya explícitamente del scope. | Agregar a Scope OUT: "concurrencia en sandbox no es un riesgo porque no modifica state" |
| F-10 | Scope creep latente | 🟡 Baja | **El context-map menciona "Decisión requerida del PO"** (¿eliminar Route C, mantener ambos, o migrar?) pero el work-item ya asume "mantener ambos con lógica compartida" sin registrar esa decisión como tomada. Si hay revert de esa decisión, el scope cambia. | Documentar en work-item que la decisión fue "mantener ambos endpoints con lógica compartida" |
| F-11 | AC redundante parcial | 🟡 Baja | **AC-5 es demasiado vago como AC testeable**. "Sigue funcionando exactamente igual que antes" no es verificable sin una lista de comportamientos específicos (endpoint URL, body format, response shape `{ output, latencyMs }`, error codes). | AC-5 debe enumerar los invariantes: mismo endpoint, mismo body schema, mismo response shape `{ output: string, latencyMs: number }` |
| F-12 | Gap de error path | 🟡 Baja | **Ningún AC cubre qué pasa si el RPC `use_trial` falla (DB error / timeout)**. El `/trial` endpoint tampoco lo cubre actualmente, pero Route C tendría que adoptar el mismo comportamiento. ¿502? ¿409? Sin AC. | Agregar AC o Scope OUT explícito sobre fallo del RPC |

---

## ACs sugeridos (agregar)

### AC-6: Sandbox fallback cuando no hay `example_output`
- **WHEN** un agente tiene `sandbox_enabled: true` **AND** no tiene `example_output` definido
- **THEN** el invoke retorna `{ result: { message: "Sandbox mode — no example output configured" }, meta: { sandbox: true, charged: 0 } }`
- **AND** no retorna error (no 500)

### AC-7: Migración pre-condición
- **WHEN** se despliega esta feature
- **THEN** la columna `sandbox_enabled boolean DEFAULT false` existe en la tabla `agents`
- **AND** el valor `'sandbox'` es un payment_type válido en `src/lib/validation/payment-type.ts`
- **AND** la columna `example_output text` existe en la tabla `agents` (o el campo ya existía)

### AC-8: Sandbox requiere autenticación en Route C
- **WHEN** llega un request con `X-Sandbox: true` a `/models/{slug}/invoke` sin JWT válido
- **THEN** la respuesta es 401 con `{ error: 'auth_required_for_sandbox' }`

### AC-9: Comportamiento de trial al fallo de upstream (AC-2 complemento)
- **WHEN** se usa el RPC `use_trial` y el upstream retorna error (4xx/5xx/timeout)
- **THEN** el trial se considera consumido (el RPC ya incrementó) **Y** la respuesta es 502/504 según corresponda
- **AND** el AC debe indicar explícitamente este comportamiento (diferencia respecto al comportamiento previo)

---

## Veredicto: NECESITA CAMBIOS

**Bloqueantes para desarrollo:**
- F-01, F-02, F-03, F-04 deben resolverse antes de spec/implementación

**Resolución rápida (mismo sprint):**
- F-05, F-06, F-07, F-08 son edge cases que pueden añadirse como ACs en la próxima iteración del work-item

**No bloqueante:**
- F-09, F-10, F-11, F-12 son mejoras de claridad
