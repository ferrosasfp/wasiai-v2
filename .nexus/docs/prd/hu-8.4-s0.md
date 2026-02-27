# HU-8.4 — Rate Limiting Configurable por Creator
**Tipo:** S0 — Historia de Usuario (Problem Definition)
**Estado:** DRAFT — pendiente HU_APPROVED de Fer
**Fecha:** 2026-02-27
**PM:** San (BMAD Agent)

---

## 1. Descripción del Problema

Actualmente WasiAI aplica rate limiting global en todos los endpoints de invocación, configurado exclusivamente por la plataforma. El creator no tiene control sobre cuántas veces puede ser llamado su agente en un período dado.

**Impacto:** Antes de abrir el registro público de creators, un actor malicioso o un consumer descuidado puede invocad el agente de un creator masivamente. Esto genera:
- Costos de infraestructura no controlados para el creator
- Degradación de servicio para otros consumers legítimos
- Pérdida de confianza en la plataforma antes del lanzamiento público

**Solución propuesta:** Permitir que cada creator configure límites de invocación por minuto y por hora en su agente, con valores por defecto razonables establecidos por WasiAI. El rate limiting se aplica por consumer sobre el agente del creator.

---

## 2. User Stories

### US-8.4.1 — Configurar límites en el dashboard
> Como **creator**, quiero poder configurar cuántas invocaciones por minuto y por hora acepta mi agente, para protegerme de abuso sin intervención de WasiAI.

### US-8.4.2 — Respuesta clara al consumer al superar el límite
> Como **consumer**, cuando supero el rate limit de un agente, quiero recibir un error claro (HTTP 429) con el tiempo de espera restante (`Retry-After`), para saber cuándo puedo volver a intentarlo.

### US-8.4.3 — Valores por defecto sensatos
> Como **creator nuevo**, si no configuro límites, quiero que mi agente tenga protección básica desde el primer momento, para no quedar expuesto desde el día del deploy.

### US-8.4.4 — Límites independientes por consumer
> Como **creator**, quiero que el rate limit se aplique por consumer individual, no globalmente, para que un consumer abusivo no afecte a los demás.

---

## 3. Criterios de Aceptación (ACs)

### AC-1: Columnas en tabla `agents`
- La tabla `agents` tiene las columnas:
  - `rate_limit_per_minute INTEGER NOT NULL DEFAULT 60`
  - `rate_limit_per_hour INTEGER NOT NULL DEFAULT 1000`
- Migration numerada como `017_agent_rate_limits.sql`
- RLS activo: solo el creator owner puede actualizar sus propias columnas

### AC-2: UI en dashboard del creator
- El creator puede editar `rate_limit_per_minute` y `rate_limit_per_hour` en la página de configuración de su agente
- Validación frontend: min 1, max 10,000 (por minuto); min 1, max 100,000 (por hora)
- El campo muestra el valor actual y tiene un botón de guardar explícito
- Los cambios se reflejan en DB vía Server Action autenticada

### AC-3: Enforcement en el endpoint de invocación
- El endpoint `/api/agents/[id]/invoke` consulta `rate_limit_per_minute` y `rate_limit_per_hour` del agente antes de procesar
- El rate limiting usa Upstash Redis con clave compuesta: `rl:{agentId}:{consumerId}:{window}` (window = `min` o `hour`)
- Si el consumer supera el límite:
  - Responde HTTP 429
  - Header `Retry-After` con segundos restantes
  - Body: `{ error: "rate_limit_exceeded", retry_after: N, limit: N, window: "minute" | "hour" }`

### AC-4: Valores por defecto aplicados
- Agentes sin `rate_limit_per_minute` explícito usan 60 rpm
- Agentes sin `rate_limit_per_hour` explícito usan 1,000 rph
- Los valores por defecto son configurables vía env var `DEFAULT_RL_PER_MINUTE` y `DEFAULT_RL_PER_HOUR` (regla: sin hardcodes)

### AC-5: Aislamiento por consumer
- El rate limit es por `(agentId, consumerId)` — un consumer abusivo no bloquea a otros
- Si el consumer no está autenticado (invocación pública), se aplica rate limit por IP con límites más estrictos (25 rpm / 200 rph)

### AC-6: Sin impacto en el contrato on-chain
- La lógica de rate limiting es solo off-chain (API + Redis)
- El contrato `WasiAI` en Fuji/Mainnet no se modifica
- El pago on-chain (USDC) solo ocurre si la invocación pasa el rate limit

---

## 4. Scope

### ✅ Dentro del scope

- Configuración de `rate_limit_per_minute` y `rate_limit_per_hour` por agente
- Enforcement en endpoint de invocación (off-chain, Redis)
- UI en dashboard del creator (editar límites)
- Valores por defecto via env vars
- Response HTTP 429 + `Retry-After`
- Migration SQL `017_agent_rate_limits.sql`
- Rate limit por consumer (no global por agente)

### ❌ Fuera del scope (explícito)

- Rate limiting on-chain / smart contract (roadmap futuro)
- Límites por plan de suscripción del creator (roadmap futuro)
- Dashboard de métricas de rate limiting para el creator (HU futura)
- Whitelist/blacklist de consumers específicos (HU futura)
- Rate limiting por modelo IA subyacente (HU futura)
- Notificaciones al creator cuando se activa el rate limit (HU futura)
- Límites diferenciados por consumer VIP (HU futura)

---

## 5. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Creator configura límite 0 o muy bajo y bloquea su propio agente | Media | Alto | Validación mínima en frontend y backend (min 1 rpm) |
| Overhead de latencia por doble consulta Redis (min + hour) | Baja | Medio | Pipeline Upstash: ambas ventanas en una sola roundtrip |
| Un creator configura límites altísimos y no sirve de protección | Alta | Bajo | Aceptable — es su decisión; WasiAI mantiene rate limit global como techo |
| Abuso por IP en invocaciones sin autenticación | Media | Medio | Rate limit por IP con límites conservadores (AC-5) |
| RLS mal configurado permite a un creator editar límites de otro | Baja | Alto | AC-1 explícita RLS; revisión adversarial antes de merge |
| Consumers con IPs rotativas evaden el rate limit por IP | Media | Bajo | Fuera de scope v1; se aborda con auth obligatoria en HU futura |

---

## 6. Dependencias

- `007_create_agents.sql` (o migration existente de tabla `agents`) — base para migration `017`
- Upstash Redis ya configurado y operativo (TOOLS.md)
- Sistema de autenticación de consumers existente (para clave `consumerId`)
- Dashboard de creator existente (para agregar la UI de configuración)

---

## 7. Definición de Hecho (DoD)

- [ ] Migration `017` aplicada en Supabase prod y dev
- [ ] RLS verificado: creator solo edita sus propios agentes
- [ ] Endpoint `/invoke` rechaza con 429 cuando corresponde
- [ ] UI del dashboard permite editar y guardar límites
- [ ] Tests de integración: invoke normal, invoke bloqueado (min), invoke bloqueado (hour)
- [ ] Revisión adversarial pasada
- [ ] Code review aprobado
- [ ] Documentado en CHANGELOG

---

**Próximo paso:** Fer lee este S0 y da **HU_APPROVED** explícito para proceder al S1 (Spec).
