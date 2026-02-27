# S0 — HU-3.3: Free Trial Controlado por Creator

**Epic:** E3 — Free Trial por Agente  
**Sprint:** 5  
**Prioridad:** P1 (UX crítica — actualmente trials ON sin consentimiento del creator)  
**Estimado:** 2 días  
**Estado:** PENDING_HU_APPROVED

---

## Historia de Usuario

Como creator de agentes en WasiAI,  
quiero poder activar o desactivar el free trial de mi agente desde mi dashboard,  
para decidir explícitamente si quiero subsidiar invocaciones gratuitas a potenciales usuarios.

---

## Contexto y Motivación

**Problema actual:** Los free trials están activos para todos los agentes sin que el creator lo sepa ni lo haya consentido. El creator está regalando invocaciones (que tienen costo de operación) sin saberlo.

**Corrección:** Free trial pasa a ser `false` por defecto. El creator activa explícitamente desde su dashboard. Si el toggle está OFF, la invocación siempre requiere API key con fondos.

**Migration requerida:** 018 (agregar `free_trial_enabled` y `free_trial_limit` a tabla `agents`)

---

## Criterios de Aceptación (ACs)

### AC1 — Migration de base de datos
- [ ] Migration `018_free_trial_creator_control.sql` aplicada
- [ ] Columna `free_trial_enabled BOOLEAN DEFAULT FALSE NOT NULL` en tabla `agents`
- [ ] Columna `free_trial_limit INT DEFAULT 1 NOT NULL` en tabla `agents` (cuántas veces por usuario puede usar el trial)
- [ ] Agentes existentes quedan con `free_trial_enabled = false` (no retroactivo)

### AC2 — API de actualización
- [ ] `PATCH /api/creator/agents/[agentId]` acepta `{ free_trial_enabled: boolean, free_trial_limit: number }`
- [ ] Validación: `free_trial_limit` debe ser ≥ 1 y ≤ 10
- [ ] Solo el creator dueño del agente puede modificar (auth guard + RLS)
- [ ] Rate limit aplicado al endpoint

### AC3 — UI en dashboard del creator
- [ ] Toggle switch "Free Trial" visible en la ficha del agente en `/creator/dashboard`
- [ ] Estado inicial del toggle refleja `free_trial_enabled` de la DB
- [ ] Al cambiar el toggle: PATCH inmediato, toast de confirmación "Free trial activado/desactivado"
- [ ] Input numérico "Invocaciones gratuitas por usuario" visible solo cuando toggle está ON (default: 1, max: 10)
- [ ] UI muestra texto explicativo: "Si activas el free trial, los usuarios pueden probar tu agente gratis hasta N veces antes de requerir una API key con fondos."

### AC4 — Lógica de invocación actualizada
- [ ] En `POST /api/v1/agents/[slug]/invoke`: antes de verificar API key, consultar `agents.free_trial_enabled`
- [ ] Si `free_trial_enabled = false` → trial bloqueado, retornar 402 con mensaje "Free trial not available for this agent"
- [ ] Si `free_trial_enabled = true` → lógica existente de `agent_trials` aplica normalmente
- [ ] La tabla `agent_trials` sigue siendo la fuente de verdad del conteo de trials usados

### AC5 — Página pública del agente actualizada
- [ ] Ficha del agente muestra badge "Free Trial Disponible" solo si `free_trial_enabled = true`
- [ ] Si `free_trial_enabled = false`, el botón de trial no aparece (no oculto, directamente ausente del DOM)

---

## Scope (qué SÍ incluye)

- Migration 018 (free_trial_enabled + free_trial_limit)
- Toggle en dashboard del creator
- Actualización de lógica en invoke route
- Actualización de UI en ficha pública del agente

## Out of Scope

- **HU-3.2** — Playground multi-agente (roadmap)
- Configuración de límite por tiempo (solo por conteo de invocaciones)
- Notificación al creator cuando alguien usa su trial
- Analytics de conversión trial → paid

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Agentes existentes con trial ON que se desactivan → creators molestos | Baja | Medio | Default FALSE para nuevos; existentes también pasan a FALSE (corrección intencional) |
| Race condition en conteo de trials (ya existente en agent_trials) | Baja | Bajo | Ya manejado con la tabla agent_trials + rate limit |
| Creator no encuentra el toggle en el dashboard | Media | Bajo | Posicionarlo cerca del precio/status del agente |

---

## Dependencias

- Tabla `agents` en Supabase (migration 018)
- `agent_trials` existente (HU-3.1 ya implementada)
- `/api/v1/agents/[slug]/invoke` existente
- Dashboard del creator existente

---

**Estado:** PENDING_HU_APPROVED  
**Requiere aprobación explícita de Fer antes de pasar a S1.**
