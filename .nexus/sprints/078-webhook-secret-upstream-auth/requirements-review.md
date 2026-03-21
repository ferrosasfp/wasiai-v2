# Requirements Review — WAS-078: Webhook Secret & Upstream Auth

**Reviewer:** Requirements Reviewer (NexusAgil)
**Fecha:** 2026-03-19
**Veredicto:** NECESITA CAMBIOS

---

## Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F-01 | AC_AMBIGUO | ALTA | AC-02: "puede ver su webhook_secret en texto plano (o rotarlo)" — el OR introduce ambigüedad. ¿Son dos acciones distintas? ¿El endpoint de consulta y el de rotación son el mismo? No es testeable con una sola aserción. | Separar en AC-02a (consulta) y AC-02b (rotación); AC-07 ya cubre rotación → unificar o eliminar el OR | 
| F-02 | AC_SOLAPADO | MEDIA | AC-02 y AC-07 se solapan: ambos hablan de "ver/rotar webhook_secret". AC-07 cubre la rotación, AC-02 la incluye implícitamente con "(o rotarlo)". Hay duplicidad parcial. | Eliminar la parte "o rotarlo" de AC-02; dejar AC-07 como única fuente de verdad para rotación |
| F-03 | PATH_FALTANTE | ALTA | No hay AC para el caso: WHEN se llama a un agente upstream Y la llamada falla (timeout, 5xx) THEN el sistema retorna un error estructurado al cliente. El comportamiento de fallo upstream no está definido. | AC-09 sugerido abajo |
| F-04 | PATH_FALTANTE | ALTA | No hay AC para: WHEN el creador NO está autenticado y consulta GET /api/creator/agents/{id} THEN SHALL retornar 401. El endpoint de consulta de webhook_secret carece de AC de error de auth. | AC-10 sugerido abajo |
| F-05 | EDGE_CASE | MEDIA | AC-07 dice "invalida el anterior" pero no especifica qué ocurre con llamadas en vuelo que usan el secret anterior al momento exacto de la rotación. ¿Hay una ventana de gracia? ¿Fallo inmediato? Esto es testeable y actualmente indefinido. | Agregar cláusula a AC-07: "...y cualquier llamada que use el secret anterior SHALL ser rechazada inmediatamente" — o definir la ventana de gracia explícitamente |
| F-06 | EDGE_CASE | MEDIA | No hay AC para: WHEN se registra un agente que ya tiene webhook_secret (re-registro o update) THEN el sistema SHALL preservar el secret existente (o regenerarlo). ¿El registro es idempotente respecto al secret? | AC-11 sugerido abajo |
| F-07 | SCOPE_FALTANTE | ALTA | AC-03 menciona "sandbox" como flujo que debe incluir webhook_secret, pero `src/app/api/v1/sandbox` no aparece en los **Archivos afectados**. Si sandbox existe y hace llamadas upstream, es un archivo afectado no listado. | Agregar sandbox/route.ts a Archivos afectados, o agregar al Scope OUT si no aplica |
| F-08 | SCOPE_FALTANTE | MEDIA | Scope OUT no excluye explícitamente: validación del secret en el lado del agente externo (el creador). Solo excluye el SDK. Si el agente externo rechaza con 401, ¿qué hace WasiAI? El comportamiento de rechazo por secret inválido del lado del receptor no está definido. | Agregar al Scope OUT: "manejo de 401 retornado por el agente externo por secret inválido" — o agregar AC |
| F-09 | DEPENDENCIA | ALTA | No se menciona la migración de BD para agregar la columna `webhook_secret` a la tabla de agentes. Solo se lista `supabase/migrations/` en archivos afectados sin detallar: tipo de columna, NOT NULL, default, índices. Esto es un gap de especificación, no de implementación. | Especificar en el Work Item: la migración debe agregar `webhook_secret TEXT NOT NULL` (o equivalente), con constraint de unicidad |
| F-10 | DEPENDENCIA | MEDIA | No se menciona si `webhook_secret` debe estar cifrado en reposo en la BD (ej. usando pgcrypto o almacenando hash). AC-02 dice "en texto plano" para la respuesta al creador, pero no dice nada sobre almacenamiento. Hay riesgo de que se asuma texto plano en BD también. | Agregar AC o nota explícita: "el webhook_secret SHALL almacenarse [en texto plano / cifrado] en la BD" |
| F-11 | AC_INCOMPLETO | MEDIA | AC-01 no especifica el formato/entropía del webhook_secret generado. "único" no es suficiente para ser testeable: ¿UUID v4? ¿32 bytes hex? ¿prefijo `whsec_`? Sin esto, no hay criterio de aceptación verificable sobre la calidad del secret. | Agregar: "...genera automáticamente un webhook_secret de al menos N bytes de entropía (ej. 32 bytes aleatorios codificados en hex/base64)" |
| F-12 | ALREADY_IMPLEMENTED | INFO | El código actual de invoke/route.ts y compose/route.ts ya envía `x-internal-secret` en llamadas upstream. AC-03 reemplazará este header con `Authorization: Bearer`. Esto es un cambio breaking para agentes que validen `x-internal-secret`. El Work Item no menciona compatibilidad hacia atrás ni deprecación de `x-internal-secret`. | Agregar al Scope OUT (o Scope IN): "deprecación/eliminación del header x-internal-secret en invoke y compose" |
| F-13 | AC_INCOMPLETO | BAJA | AC-04 y AC-05 solo excluyen `endpoint_url` de la respuesta pública. No especifican si `webhook_secret` también debe estar ausente. Aunque parece obvio, no está explícito, lo que lo hace no testeable sin ambigüedad. | Agregar a AC-04 y AC-05: "...y NO contiene webhook_secret" |

---

## ACs sugeridos (agregar)

**AC-09:** WHEN WasiAI llama al endpoint_url de un agente (vía cualquier flujo) Y la llamada retorna timeout o error HTTP 5xx THEN el sistema SHALL retornar al cliente un error 502/503 con mensaje estructurado. *(error path de upstream)*

**AC-10:** WHEN un cliente no autenticado llama al endpoint de consulta de webhook_secret THEN el sistema SHALL retornar HTTP 401. *(auth error path)*

**AC-11:** WHEN se re-registra un agente que ya tiene webhook_secret asignado THEN el sistema SHALL preservar el webhook_secret existente y NO generar uno nuevo. *(idempotencia de registro)*

---

## Veredicto

**NECESITA CAMBIOS**

Bloqueantes:
- F-07: sandbox no está en archivos afectados pero está en AC-03
- F-09: migración de BD sin especificación de columna
- F-03: error path de upstream completamente ausente
- F-04: error path de auth en endpoint de creador ausente
- F-12: impacto breaking sobre x-internal-secret no mencionado

No bloqueantes (pueden resolverse en implementación con acuerdo del equipo): F-05, F-06, F-10, F-11, F-13
