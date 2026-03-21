# Security Review — SDD #258 (commit 4e0db2340)

**Revisado por:** Security Reviewer — NexusAgil v1.3  
**Fecha:** 2026-03-20  
**Branch:** improvement/258-void-promise-after  
**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

---

## Superficie de ataque

| Categoría | Cambio | Status |
|-----------|--------|--------|
| Auth/Authorization | Ninguno — operaciones background no modifican quién puede llamar al endpoint | ✅ Sin cambio |
| Endpoint `/invoke` | La firma del endpoint, headers, y respuesta al cliente son idénticos pre/post cambio | ✅ Sin cambio |
| Ejecución de código externo | `after()` es registrado síncronamente durante el request; no hay superficie de llamada externa | ✅ Sin riesgo |
| Contexto de closure | Las 3 callbacks capturan `supabase` (service client), variables server-side (`callId`, `slug`, `settlement`, `creatorPrice`) | ⚠️ Ver F-01 |
| Logging | Se añade `slug` a dos entradas de log existentes; `txHash` y `err` ya existían | ⚠️ Ver F-02 |
| Privilegio del cliente Supabase | Todos los `after()` callbacks en POST usan `createServiceClient()` (service role, bypasses RLS) | ✅ Correcto y necesario |

---

## Análisis de preguntas específicas

### ¿`after()` puede ser manipulado externamente?
**No.** `after()` de Next.js/Vercel es un mecanismo server-side que registra callbacks síncronamente durante el ciclo de vida del request. No expone ningún endpoint ni superficie de red adicional. El callback se ejecuta en el mismo runtime de Vercel post-response, dentro del contexto del request original via `AsyncLocalStorage`. Un atacante externo no tiene forma de registrar, modificar, o disparar callbacks `after()` directamente.

### ¿Las variables de closure pueden filtrar datos sensibles?
**No hay fuga al cliente.** Las closures capturan variables server-side (`supabase` service client con service_role_key, `callId`, `receiptSignature`, `slug`, `settlement.transactionHash`, `model.creator_id`, `creatorPrice`). Estos datos nunca salen del runtime de Vercel — van únicamente a Supabase o a los logs server-side. El cliente solo recibe la respuesta ya enviada antes de que `after()` ejecute. No existe un mecanismo por el cual el payload de la closure llegue al cliente.

### ¿Introduce TOCTOU o race conditions?
**No introduce races nuevas explotables.** El comportamiento pre-cambio con `void Promise.resolve()` ya era fire-and-forget asíncrono. La diferencia es que `after()` garantiza ejecución post-response mientras que `void Promise` podía ser silently dropped por Vercel. Si acaso, `after()` *reduce* la ventana de inconsistencia. Los tres callbacks operan sobre registros ya committed antes de `after()` ejecutar (`callId` ya existe en DB, settlement ya verificado), por lo que no hay TOCTOU entre verificación y acción.

**Consideración de consistencia eventual (no es un finding de seguridad):** `increment_pending_earnings` se ejecuta después de que la respuesta llega al cliente. Un creador que consulte su balance inmediatamente podría ver el estado pre-incremento. Esto es aceptable y era el comportamiento implícito antes.

### ¿El logging expone datos sensibles?
**Parcialmente — ver F-02.** Los logs son server-side (Vercel/stderr), no expuestos al cliente. El `transactionHash` es un hash de blockchain pública — no es confidencial. El `slug` es público. El `err.message` de Supabase podría contener detalles internos de esquema, pero solo en logs server-side.

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea | Explotabilidad |
|---|-----------|-----------|---------|---------------|----------------|
| F-01 | LOW | Menor privilegio | El `supabase` service client (service_role_key, bypasses RLS completamente) es capturado en closure. Las operaciones están correctamente acotadas: receipt_signature usa `.eq('id', callId)` con callId server-generated; settlement_failures usa solo valores server-derived; increment_pending_earnings usa `model.creator_id` y `creatorPrice` ambos server-side. No hay input del usuario que pueda redirigir estas operaciones. El privilegio elevado es necesario y el scope está bien contenido. | route.ts:358–372, 507–530, 544–556 | Ninguna — no hay vector de ataque |
| F-02 | LOW | Datos sensibles en logs | `txHash: settlement.transactionHash` se loguea en tres lugares dentro de `after()`. El txHash es una transacción pública en Avalanche — inherentemente público. Sin embargo, si los logs de Vercel son accedidos por terceros (breach del dashboard), la correlación txHash+slug+timestamp podría revelar información de uso. El `err` object sin sanitizar podría contener mensajes de error internos de Supabase (schema names, constraint names). | route.ts:521, 523, 526 | Baja — requiere acceso a Vercel logs |
| F-03 | INFO | Disponibilidad de service client en after() | `createServiceClient()` usa `SUPABASE_SERVICE_ROLE_KEY` del entorno. Las env vars son accesibles en `after()` en Vercel Node.js runtime. En Edge Runtime esto podría comportarse diferente, pero esta ruta es Node.js. No es un problema de seguridad pero documentar para future-proofing si se migra a Edge. | route.ts:148 | Ninguna actualmente |
| F-04 | INFO | Error handling mejorado (positivo) | El cambio introduce `try/catch` explícito en los tres callbacks vs el `.catch()` encadenado anterior. Esto garantiza que errores síncronos dentro de los callbacks también son capturados. Mejora la superficie de error handling. | route.ts:360–370, 509–528, 546–556 | N/A — mejora de seguridad |

---

## Resumen

| Severidad | Cantidad |
|-----------|----------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 |
| INFO | 2 |

---

## Veredicto

### ✅ SEGURO

El cambio es una refactorización segura que mejora la garantía de ejecución de operaciones background sin introducir nuevas superficies de ataque. `after()` de Next.js no expone superficie externa, las closures no filtran datos al cliente, no hay TOCTOU explotable, y el service client usa un scope correctamente acotado a operaciones server-determinadas.

Los dos findings LOW son observaciones de hardening de logging (txHash en logs server-side es aceptable dado que es dato blockchain público) y del scope del service client (correcto y necesario). No requieren corrección para shipping.

**Recomendación opcional (no bloqueante):** Si en el futuro los logs de Vercel son enviados a un SIEM externo, considerar sanitizar `err` objects de Supabase antes de logging para evitar exposición de detalles de esquema interno.
