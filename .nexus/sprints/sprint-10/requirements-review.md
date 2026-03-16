# Requirements Review — Sprint 10 WasiAI
**Reviewer:** NexusAgil Requirements Reviewer v1.3  
**Fecha:** 2026-03-16  
**Scope:** WAS-216, WAS-217, WAS-218, WAS-223

---

## 🔴 Findings Table

| ID | Issue | Severidad | Categoría | Descripción |
|----|-------|-----------|-----------|-------------|
| F-01 | WAS-216 | ALTA | Seguridad | No hay AC para access control en `batchSelfRegister`: ¿puede un creator registrar slugs de otro? El `msg.sender = creator` está mencionado pero no hay AC explícito de test para intento de registro de slug ajeno (debe revertir) |
| F-02 | WAS-216 | ALTA | Edge Case | `batchSelfRegister` con arrays de largo desigual (slugs.length ≠ prices.length ≠ erc8004Ids.length) — no hay AC para validar que revierta con mensaje claro |
| F-03 | WAS-216 | ALTA | Edge Case | `batchSelfRegister` con slug ya registrado — ¿revierte toda la tx o skippea? Comportamiento no especificado. Inconsistente con el diseño graceful de `settleKeyBatch` |
| F-04 | WAS-216 | ALTA | Migración | AC-9 menciona "registrar los 5 agentes" pero no especifica: verificación post-deploy de que agentEarnings y ReputationRecords del contrato viejo (aunque sea 0) están correctamente inicializados. Sin estado previo que migrar ≠ sin verificación |
| F-05 | WAS-216 | ALTA | Faltante | No hay AC para evento `AgentRegistered` en `batchSelfRegister` — el frontend WAS-217 necesita confirmar on-chain que el registro fue exitoso. Sin evento, AC-5 de WAS-217 es imposible de implementar de forma confiable |
| F-06 | WAS-216 | MEDIA | Faltante | No hay AC para `deregisterAgent` o mecanismo de baja. Si un agente se da de baja del marketplace ¿qué pasa con sus earnings acumulados? |
| F-07 | WAS-216 | MEDIA | Faltante | `ReputationRecord.avgResponseMs` — no hay AC que especifique cómo se actualiza (¿en settlement? ¿quién puede escribirlo? ¿el operator?). Sin esto, el campo queda definido pero inutilizable |
| F-08 | WAS-216 | MEDIA | Faltante | No hay AC para `getAgentEarnings(slug)` como función de lectura pública. WAS-218 la necesita para mostrar balances |
| F-09 | WAS-216 | MEDIA | Tests | AC-8 no incluye test para: (a) arrays desiguales en batchSelfRegister, (b) re-registro de slug existente, (c) intento de registro por non-creator, (d) settleKeyBatch con mezcla de slugs registrados y no-registrados |
| F-10 | WAS-216 | MEDIA | Faltante | No hay AC de verificación de dirección del nuevo contrato en variables de entorno / configuración del backend antes de deploy. Sin esto, el backend podría seguir apuntando al contrato viejo |
| F-11 | WAS-216 | INFO | NatSpec | AC-11 dice "NatSpec completo en cada función pública" pero no menciona eventos ni errores custom. Los `@notice` de eventos son parte del ABI y los indexers los usan |
| F-12 | WAS-217 | ALTA | Faltante | No hay AC para el caso: `batchSelfRegister` falla (tx revertida) en Paso 1. ¿Qué muestra el UI? ¿Puede el usuario reintentar? Sin manejo de error, el flujo queda roto silenciosamente |
| F-13 | WAS-217 | ALTA | Faltante | No hay AC para timeout/polling de confirmación de la tx de Paso 1. En Avalanche C-Chain los bloques son rápidos (~2s) pero la tx puede quedar pending. ¿Cuánto espera el frontend antes de mostrar error? |
| F-14 | WAS-217 | ALTA | Edge Case | ¿Qué pasa si entre Paso 1 (registro) y Paso 2 (claim) el usuario cierra el browser o pierde conexión? El estado "Paso 1 completo, Paso 2 pendiente" no tiene AC de recovery/persistencia |
| F-15 | WAS-217 | ALTA | Dependencia | WAS-217 depende de WAS-216 (batchSelfRegister) pero no está declarada como dependencia bloqueante. Si WAS-216 no cierra en el sprint, WAS-217 no puede completarse. Falta enlace explícito |
| F-16 | WAS-217 | MEDIA | Faltante | No hay AC para mostrar el costo de gas estimado del Paso 1 (registro batch) antes de que el usuario firme. En mainnet Avalanche esto importa |
| F-17 | WAS-217 | MEDIA | Faltante | No hay AC para el caso en que el creator tiene agentes sin `erc8004Id` (campo requerido en batchSelfRegister). ¿El UI los bloquea? ¿Los omite? ¿Muestra advertencia? |
| F-18 | WAS-217 | MEDIA | Edge Case | AC-7: `pendingEarnings = 0` → botón deshabilitado. Pero ¿qué pasa si hay agentes off-chain Y earnings = 0? ¿Se deshabilita el botón completo o solo el Paso 2? El flujo de 2 pasos no debería iniciarse si no hay nada que retirar |
| F-19 | WAS-217 | INFO | UX | No hay AC para feedback de loading entre confirmación de tx y avance automático a Paso 2. UX incompleta sin spinner/estado intermedio |
| F-20 | WAS-218 | ALTA | Faltante | `balance_synced_at` NO EXISTE en DB (confirmado en código actual). AC-2 asume que existe. Falta AC explícito de **migración de esquema** para agregar la columna con valor default (NOW() o NULL) |
| F-21 | WAS-218 | ALTA | Faltante | No hay AC para manejo de error cuando `getKeyBalance` on-chain falla (RPC timeout, nodo caído). ¿El endpoint devuelve el valor cacheado? ¿Devuelve error? Sin fallback definido, el sistema puede quedar inoperante |
| F-22 | WAS-218 | ALTA | Faltante | No hay AC para rate limiting del botón "Sync" — un usuario podría spamear /sync-balance generando costos de RPC. Falta cooldown mínimo (ej: 30s por key) |
| F-23 | WAS-218 | MEDIA | Faltante | No hay AC que defina el TTL del caché (balance_synced_at). ¿Cuándo se considera el balance "stale" y requiere sync? Sin TTL definido, el AC-2 es ambiguo |
| F-24 | WAS-218 | MEDIA | Faltante | No hay AC para `/sync-balance` endpoint en sí — qué parámetros acepta, qué devuelve, quién puede llamarlo (autenticación). Se menciona en AC-5 pero no hay spec del endpoint |
| F-25 | WAS-218 | MEDIA | Edge Case | AC-3 y AC-4 dicen "actualiza budget_usdc post-tx" pero no especifican: ¿actualización optimista (antes de confirmación on-chain) o esperando confirmación? Si optimista, ¿qué pasa si la tx falla? |
| F-26 | WAS-218 | MEDIA | Dependencia | WAS-218 depende de WAS-216 (necesita `getAgentEarnings(slug)` y nuevo contrato deployado) pero no está declarada como dependencia. Si el contrato V2 no está disponible, AC-1 no puede implementarse |
| F-27 | WAS-218 | INFO | Faltante | No hay AC para el caso en que una key tiene múltiples agentes asociados — ¿el balance on-chain es por key o por (key, agente)? La semántica no está definida |
| F-28 | WAS-223 | ALTA | Migración | AC-6 dice "migración DB backfill" pero no especifica: (a) qué valor asignar a las 36 rows con agent_slug NULL, (b) qué payment_type asignar a los registros actuales 'x402', (c) qué hacer con registros donde amount_paid = 0 y el nuevo constraint requeriría > 0. Sin estrategia de backfill concreta, la migración puede fallar en prod |
| F-29 | WAS-223 | ALTA | Faltante | No hay AC para la estrategia de deploy de la migración con datos en producción. ¿Se hace con tabla temporal? ¿Con downtime? ¿En dos fases (agregar constraint nullable → backfill → hacer NOT NULL)? |
| F-30 | WAS-223 | ALTA | Faltante | No hay AC para el path `src/lib/x402/x402Handler.ts` — está listado como path de insert pero no se menciona explícitamente que debe ser actualizado. Puede quedar sin tipado |
| F-31 | WAS-223 | ALTA | Edge Case | AC-4: `amount_paid > 0` si payment_type IN ('api_key', 'x402') — ¿qué pasa con llamadas fallidas que llegaron a cobrar pero fallaron mid-flight? ¿Se registran con amount_paid = 0 y payment_type = 'api_key'? El constraint bloquearía ese insert |
| F-32 | WAS-223 | MEDIA | Faltante | No hay AC para validación a nivel de aplicación (no solo DB constraint) del payment_type. Si el constraint falla, el error de DB llega al usuario. Debería haber validación previa que devuelva error 400 claro |
| F-33 | WAS-223 | MEDIA | Faltante | No hay AC para `free_trial` y `sandbox` en el flujo de settlement. AC-5 dice "filtra solo api_key" pero no especifica qué pasa con las otras categorías — ¿se ignoran silenciosamente o hay logging? |
| F-34 | WAS-223 | MEDIA | Scope Creep | El path `src/app/api/v1/compose/route.ts` sugiere que hay un endpoint de composición de agentes que no está documentado en ningún otro issue del sprint. Si tiene lógica de payment, puede tener edge cases propios que no están cubiertos |
| F-35 | WAS-223 | INFO | Faltante | No hay AC para índice en `(agent_slug, payment_type)` en agent_calls. Con el NOT NULL constraint y el filtro por payment_type en settlement, este índice es necesario para performance en prod |

---

## 📋 ACs Sugeridos por Issue

### WAS-216 — ACs faltantes

```
AC-12: batchSelfRegister DEBE revertir con "WasiAI: array length mismatch" si slugs.length ≠ prices.length ≠ erc8004Ids.length
AC-13: batchSelfRegister DEBE revertir si msg.sender ≠ creator del slug (o slug ya registrado por otro) — no silencioso
AC-14: batchSelfRegister DEBE emitir evento AgentRegistered(slug, creator, price, erc8004Id) por cada agente registrado
AC-15: batchSelfRegister con slug ya registrado DEBE [definir: revertir / skipear con evento] — comportamiento explícito requerido
AC-16: updateReputationRecord(slug, responseMs, success) — función callable solo por operator, actualiza avgResponseMs y contadores
AC-17: getAgentEarnings(slug) — función de lectura pública que devuelve agentEarnings[slug]
AC-18: Post-deploy script DEBE verificar que los 5 agentes son legibles via getAgent(slug) en el nuevo contrato
AC-19: El nuevo contrato address DEBE ser actualizado en variables de entorno y documentado en .env.example
AC-20: Tests Foundry adicionales: (a) arrays desiguales, (b) re-registro slug existente, (c) registro por non-creator, (d) batch mix de slugs registrados/no-registrados en settleKeyBatch
```

### WAS-217 — ACs faltantes

```
AC-8: IF batchSelfRegister (Paso 1) falla → mostrar error con mensaje del revert + opción de reintentar
AC-9: Frontend DEBE hacer polling de confirmación de Paso 1 con timeout de 30s; si no confirma → mostrar estado "Tx pendiente" con link al explorador
AC-10: IF el usuario cierra el browser antes de completar Paso 2 → al reabrir Withdraw, detectar que Paso 1 ya está completo y mostrar directamente Paso 2
AC-11: UI DEBE mostrar estimación de gas antes de solicitar firma de Paso 1
AC-12: Agentes sin erc8004Id asignado DEBEN ser excluidos del batchSelfRegister con advertencia visible al usuario
AC-13: IF hay agentes off-chain Y pendingEarnings = 0 → botón deshabilitado con tooltip "Registra tus agentes para acumular earnings"
AC-14: DEPENDS ON WAS-216 — este issue es bloqueado por WAS-216 y no puede completarse sin contrato V2 deployado
```

### WAS-218 — ACs faltantes

```
AC-7: Migración de esquema: agregar columna balance_synced_at TIMESTAMPTZ DEFAULT NULL a agent_keys
AC-8: IF getKeyBalance on-chain falla (RPC error/timeout) → /agent-keys DEBE devolver último valor cacheado con flag "stale: true" y balance_synced_at
AC-9: /sync-balance DEBE tener rate limit de 1 request por key cada 30 segundos; responder 429 si se excede
AC-10: balance_synced_at > 5 minutos → UI DEBE mostrar indicador "Balance desactualizado" junto al valor
AC-11: /sync-balance spec: POST /api/v1/agent-keys/{keyId}/sync-balance, autenticado, devuelve {budget_usdc, balance_synced_at}
AC-12: Actualización de budget_usdc post-tx (AC-3, AC-4) DEBE esperar confirmación on-chain (1 bloque), no optimista
AC-13: DEPENDS ON WAS-216 — requiere contrato V2 con getAgentEarnings(slug) disponible
```

### WAS-223 — ACs faltantes

```
AC-7: Estrategia de backfill explícita:
  - Rows con agent_slug NULL → actualizar con slug inferido desde context o marcar como 'unknown' + flag requires_review
  - Rows con payment_type NULL/vacío → asignar 'x402' si amount_paid > 0, 'free_trial' si amount_paid = 0
  - Rows con amount_paid = 0 y payment_type api_key/x402 → reclasificar a 'free_trial' o documentar excepción
AC-8: Migración en 2 fases para zero-downtime: Fase 1 = agregar columna nullable + default; Fase 2 = backfill + agregar NOT NULL constraint
AC-9: src/lib/x402/x402Handler.ts DEBE ser actualizado para incluir payment_type explícito en todos los inserts
AC-10: Validación a nivel de aplicación del payment_type antes del insert: devolver HTTP 400 con mensaje claro si payment_type inválido
AC-11: Llamadas fallidas (error mid-flight) con payment_type api_key/x402 PUEDEN tener amount_paid = 0 — el constraint DEBE permitir esto o redefinirse como amount_paid >= 0 con regla de negocio separada
AC-12: Agregar índice compuesto (agent_slug, payment_type, created_at) en agent_calls para queries de settlement
AC-13: free_trial y sandbox excluidos de settlement DEBEN ser logueados (nivel DEBUG) con razón de exclusión
```

---

## ✅ Veredicto por Issue

### WAS-216 — QUALITY — Nuevo contrato V2
**Veredicto: ⚠️ APROBADO CON OBSERVACIONES — No listo para sprint sin cambios**

Los ACs cubren lo esencial pero faltan 8 ACs críticos (access control, array validation, eventos para frontend, función de lectura). Sin AC-14 (evento AgentRegistered), WAS-217 no puede completarse. Sin AC-17 (getAgentEarnings), WAS-218 no puede completarse. **Esta issue bloquea las otras 2 HU-MAJOR del sprint.**

**Riesgo principal:** El contrato puede deployarse correctamente pero dejar al backend/frontend sin forma de consultar earnings por slug ni de confirmar registros. Migración de producción sin verificación post-deploy.

---

### WAS-217 — HU-MAJOR — Flujo Withdraw
**Veredicto: 🔴 NO APROBADO — Flujo incompleto, gaps críticos de UX y error handling**

Faltan completamente: manejo de errores de tx, recovery de estado entre sesiones, casos límite de erc8004Id, y la dependencia bloqueante con WAS-216 no está declarada. El happy path está bien especificado pero el issue no puede salir a producción solo con el happy path.

**Riesgo principal:** El usuario puede perder earnings si la tx falla silenciosamente o si pierde conexión entre Paso 1 y Paso 2.

---

### WAS-218 — HU-MAJOR — On-chain como fuente de verdad
**Veredicto: 🔴 NO APROBADO — Dependencia de migración de esquema no declarada**

El AC-2 asume que `balance_synced_at` existe en DB pero la columna NO EXISTE en producción (confirmado en contexto). Sin el AC de migración, el issue no puede implementarse. Además faltan: fallback ante RPC failure, rate limiting del sync, TTL del caché, y spec del endpoint.

**Riesgo principal:** Deploy a producción sin la columna `balance_synced_at` → error 500 en /agent-keys para todos los usuarios.

---

### WAS-223 — HU-MAJOR — Tipado estricto de pagos
**Veredicto: ⚠️ APROBADO CON OBSERVACIONES — Necesita estrategia de migración concreta**

El análisis de qué cambiar está bien hecho. El problema es que la migración de las 36 rows con agent_slug NULL y los registros de payment_type no está especificada concretamente. Sin estrategia de backfill, la migración de DB en producción puede fallar o corromper datos. `x402Handler.ts` no está cubierto explícitamente.

**Riesgo principal:** Migración falla en producción por constraint violation en rows existentes con amount_paid = 0.

---

## 🔗 Dependencias entre Issues (no declaradas)

```
WAS-216 ──bloqueante──▶ WAS-217 (necesita batchSelfRegister + AgentRegistered event)
WAS-216 ──bloqueante──▶ WAS-218 (necesita getAgentEarnings(slug) en contrato V2)
WAS-218 ──requiere──▶ migración de esquema (balance_synced_at) — no es un issue separado pero debe ocurrir antes del deploy
WAS-223 ──requiere──▶ coordinación con WAS-217 (settlement filtra api_key — debe estar sincronizado)
```

**Orden de implementación recomendado:**
1. WAS-223 (migración DB — independiente, reduce riesgo antes de otros cambios)
2. WAS-216 (contrato V2 con todos los ACs — bloqueante de todo lo demás)
3. WAS-218 (on-chain balances — depende de WAS-216 deployado)
4. WAS-217 (flujo withdraw — depende de WAS-216 + WAS-218)

---

## 📊 Resumen de Findings

| Severidad | Cantidad |
|-----------|----------|
| 🔴 ALTA   | 15       |
| 🟡 MEDIA  | 15       |
| 🔵 INFO   | 5        |
| **TOTAL** | **35**   |

| Issue | ACs actuales | ACs sugeridos adicionales | Estado |
|-------|-------------|--------------------------|--------|
| WAS-216 | 11 | +9 | ⚠️ Con observaciones |
| WAS-217 | 7 | +7 | 🔴 No aprobado |
| WAS-218 | 6 | +7 | 🔴 No aprobado |
| WAS-223 | 6 | +7 | ⚠️ Con observaciones |

---

*Generado por NexusAgil Requirements Reviewer v1.3 — Sprint 10 WasiAI*
