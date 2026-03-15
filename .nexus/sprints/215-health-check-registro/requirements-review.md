# Requirements Review — WAS-215

**Reviewer:** NexusAgil Requirements Reviewer v1.3  
**Fecha:** 2026-03-14  
**Work Item:** Health Check Síncrono en Registro de Agente

---

## Requirements Review — WAS-215

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | 🚨 Riesgo técnico | CRÍTICA | El health check tiene timeout de 10s pero Vercel Serverless (plan free) también tiene timeout de 10s. El request completo (validación SSRF + DB write + probe HTTP) casi con certeza agotará el tiempo disponible. No hay ningún AC ni scope note que reconozca este riesgo ni defina el comportamiento esperado cuando el *propio* handler hace timeout. | AC nuevo: WHEN la función serverless alcanza su límite de tiempo antes de completar el health check, THE system SHALL registrar el agente con status = reviewing y health_check: { passed: false, reason: "server_timeout" }. |
| F2 | 🔴 Gap de cobertura | ALTA | AC5 solo dice "actualizar status a active si pasa" — no especifica qué ocurre si el re-check falla: ¿se revierte a reviewing? ¿se mantiene el status anterior? El comportamiento de fallo en re-verificación es un path no cubierto. | Agregar a AC5: "WHEN health check falla, THE agent status SHALL ser reviewing y la respuesta SHALL incluir health_check con razón del fallo." |
| F3 | 🔴 Dependencia DB no declarada | ALTA | Se requieren al menos dos columnas nuevas en la tabla `agents` (`last_checked_at`, columna o JSONB para `health_check`) pero el Work Item no lista la migración como dependencia bloqueante ni como tarea del sprint. Si la migración no está lista antes del desarrollo, todos los ACs que la usan (AC2, AC3, AC4, AC5) fallan. | Agregar a Dependencias: "Migración DB: añadir `last_checked_at TIMESTAMPTZ` y `health_check JSONB` a tabla `agents`. Bloqueante para AC2, AC3, AC4, AC5." |
| F4 | 🔴 Conflicto de endpoints | ALTA | AC5 especifica `PATCH /api/creator/agents/:slug` que es una ruta de UI interna, no una API pública versionada. El Scope IN dice "PATCH endpoint_url dispara re-verificación" sin aclarar si aplica solo a esa ruta o también debería exponerse en `/api/v1`. Ambigüedad que puede generar scope creep o comportamiento inconsistente. | Aclarar en Scope IN: "La re-verificación aplica únicamente al PATCH existente en `/api/creator/agents/[slug]`. No se crea endpoint PATCH en `/api/v1` en este sprint." |
| F5 | 🟡 Conflicto con código existente | MEDIA | Ya existe `GET /api/v1/agents/:slug/health` con timeout de 5s. AC1 define un nuevo health check con timeout 10s integrado en el registro. No se especifica si el endpoint existente se alinea al nuevo timeout, si se depreca, ni si comparten la misma lógica interna. Riesgo de divergencia de comportamiento. | Agregar nota de scope: "GET /api/v1/agents/:slug/health existente no se modifica en este sprint. La lógica del probe se extrae a función compartida para evitar duplicación." |
| F6 | 🟡 AC incompleto | MEDIA | AC4 (GET status) no especifica el esquema exacto de respuesta: ¿qué campos además de `status`, `health_check` y `last_checked_at`? ¿Se incluye `slug`, `endpoint_url`? Tampoco define qué retorna cuando el agente nunca ha tenido un health check (last_checked_at = null, health_check = null). | Agregar a AC4: "WHEN el agente nunca ha sido verificado, health_check SHALL ser null y last_checked_at SHALL ser null. La respuesta SHALL incluir al menos: { status, health_check, last_checked_at }." |
| F7 | 🟡 Edge case faltante | MEDIA | No hay AC para el caso en que `endpoint_url` sea null o vacío al momento del registro. ¿El sistema registra el agente sin hacer health check? ¿Retorna error? ¿Asigna status draft? El comportamiento es completamente indefinido. | AC nuevo: WHEN POST /api/v1/agents/register no incluye endpoint_url o es null, THE system SHALL registrar el agente con status = draft y health_check: null, sin ejecutar probe. |
| F8 | 🟡 Autenticación de AC4 incompleta | MEDIA | AC4 define auth con `x-agent-key del owner` pero no especifica qué retorna cuando la key es inválida, expirada, o pertenece a otro agente (not owner). Solo el happy path está cubierto. | Agregar a AC4: "WHEN x-agent-key es inválida o no corresponde al owner del slug, THE endpoint SHALL retornar 401 Unauthorized." |
| F9 | 🟡 Scope OUT incompleto | MEDIA | El Scope OUT no menciona explícitamente rate limiting del health check endpoint ni protección contra abuso de re-verificaciones (un actor podría hacer PATCH endpoint_url repetidamente para provocar probes masivos hacia un target). | Agregar a Scope OUT: "Rate limiting de re-verificaciones (fuera de scope de este sprint — registrar como deuda técnica)." |
| F10 | 🟢 Calidad de AC | BAJA | AC6 usa "SHALL reutilizar" que es un detalle de implementación, no un requisito verificable. Un AC debe describir comportamiento observable, no cómo implementarlo. | Reescribir AC6: "WHEN el health check va a realizar un probe, THE system SHALL rechazar endpoint_urls que sean IPs privadas, localhost, o dominios internos, retornando reason: 'ssrf_blocked'." |
| F11 | 🟢 Ambigüedad en AC7 | BAJA | AC7 especifica `reason "http_error" + status code` pero no define cómo se serializa: ¿`{ reason: "http_error", status_code: 503 }`? ¿`{ reason: "http_error_503" }`? El esquema exacto del campo `fix` en AC3 tampoco está definido (¿string? ¿objeto?). | Agregar sección "Esquemas de respuesta" con el shape exacto de `health_check` en los tres casos (passed, http_error, timeout, connection_error). |

---

### ACs sugeridos

**AC8 (nuevo) — Vercel/serverless timeout:**
```
WHEN la función serverless alcanza su límite de tiempo antes de completar el health check,
THE system SHALL registrar el agente con status = reviewing
y health_check: { passed: false, reason: "server_timeout", message: "Health check could not complete within server time limit", fix: "Retry registration or use /api/v1/agents/:slug/status to check current status" }.
```

**AC9 (nuevo) — endpoint_url ausente:**
```
WHEN POST /api/v1/agents/register no incluye endpoint_url (campo null, vacío o ausente),
THE system SHALL registrar el agente con status = draft
y la respuesta 201 SHALL incluir health_check: null.
```

**AC10 (nuevo) — SSRF bloqueado como comportamiento observable:**
```
WHEN endpoint_url resuelve a una IP privada, loopback, o dominio interno,
THE health check SHALL fallar sin realizar el probe
y health_check SHALL incluir { passed: false, reason: "ssrf_blocked", message: "Endpoint URL is not publicly reachable", fix: "Use a publicly accessible HTTPS endpoint" }.
```

**AC5 revisado — path de fallo en re-verificación:**
```
WHEN PATCH /api/creator/agents/:slug recibe nuevo endpoint_url,
THE system SHALL disparar health check y:
  - Si pasa → status = active, respuesta incluye health_check: { passed: true, latency_ms: N }
  - Si falla → status = reviewing, respuesta incluye health_check: { passed: false, reason, message, fix }
```

---

### Dependencias bloqueantes no listadas

1. **Migración DB** — Columnas `last_checked_at TIMESTAMPTZ` y `health_check JSONB` en tabla `agents`. Debe completarse antes de iniciar desarrollo de AC2, AC3, AC4, AC5.
2. **Decisión de timeout** — Definir timeout efectivo del probe (¿7s para dejar margen al handler? ¿usar Edge Functions?) antes de AC1. Debe resolverse en refinamiento, no en desarrollo.
3. **Esquema de respuesta formalizado** — Shape exacto del objeto `health_check` debe documentarse (ver F11) antes de que QA pueda escribir tests.

---

### Veredicto: NECESITA CAMBIOS

**Razón principal:** F1 (riesgo de timeout en Vercel) y F3 (migración DB no declarada como bloqueante) son gaps críticos que pueden hacer que la feature falle en producción o bloquee el desarrollo sin aviso. F2 y F4 son ambigüedades que generarán decisiones ad-hoc durante el desarrollo, con riesgo de comportamiento inconsistente.

**Mínimo para aprobar:**
- [ ] Resolución documentada del conflicto timeout Vercel/health-check (F1)
- [ ] Migración DB listada como tarea bloqueante (F3)  
- [ ] AC5 completado con path de fallo (F2)
- [ ] Aclaración de scope en PATCH endpoint (F4)
- [ ] AC para endpoint_url ausente (F7)
