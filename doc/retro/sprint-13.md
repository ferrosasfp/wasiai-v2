# Retrospectiva Sprint 13 — WasiAI

**Fecha:** 2026-03-02
**Estado:** RETRO_APPROVED ⏳ (pendiente aprobación de Fer)
**Scrum Master:** San (NexusAgil)

---

## ✅ Lo que salió bien

- **3 sub-agentes en paralelo** — WAS-70, WAS-73, WAS-74 corrieron simultáneamente sin bloqueos entre sí
- **WAS-74 Fase 2 se completó en el mismo sprint** — oportunismo bien aprovechado, entregamos más de lo planeado
- **Los sub-agentes detectaron patrones de auth reales del codebase** y los usaron correctamente en lugar de inventar implementaciones
- **NexusAgil v1.0 documentado** — metodología formalizada y disponible para el equipo
- **Decisiones autónomas de mayor calidad** — los sub-agentes detectaron paquetes obsoletos y adaptaron firmas incorrectas sin intervención manual. Esto valida que el patrón **"Critical Constraints: leer antes de modificar"** en los SDDs funciona. Los agentes son más confiables cuando el SDD los obliga a leer antes de actuar.

---

## ⚠️ Lo que mejorar

### Problema 1: Números de migración SQL en SDDs no coincidían con el repo real
Los SDDs documentaron números de migración que no existían en `supabase/migrations/`, causando drift entre documentación e implementación.

**Acción concreta — Regla para futuros SDDs:**
> **Regla 1:** Antes de escribir cualquier SDD, verificar el último número de migración en `supabase/migrations/` y usar el siguiente número correcto. Sin excepciones.

---

### Problema 2: `verifyAdminSignature` tenía firma diferente a la documentada en el SDD
El SDD documentó una firma de función sin leer el archivo real, lo que generó código incorrecto en la implementación.

**Acción concreta — Regla para futuros SDDs:**
> **Regla 2:** Antes de documentar cualquier función importada en un SDD, leer el archivo fuente real de esa función. Documentar la firma exacta que existe, no la que se asume.

---

### Problema 3: Migraciones 027 y 028 en código pero NO aplicadas en Supabase producción 🚨
Las migraciones existen en el repositorio pero no fueron ejecutadas en la base de datos de producción. **Jobs y webhooks no funcionarán hasta que se apliquen.** Esto es un riesgo activo en producción.

**Acción concreta:**
> Aplicar migraciones 027 y 028 en Supabase antes de iniciar cualquier trabajo que dependa de jobs o webhooks. **Tarea bloqueante para Sprint 14.**

---

## 🚀 Acciones para Sprint 14

| # | Acción | Tipo | Responsable |
|---|--------|------|-------------|
| 1 | Aplicar migraciones 027 y 028 en Supabase producción | **BLOQUEANTE** | Dev / Fer |
| 2 | Agregar Regla 1 al template de SDD (verificar último número de migración) | Proceso | San |
| 3 | Agregar Regla 2 al template de SDD (leer función real antes de documentarla) | Proceso | San |

---

## 📊 Métricas del sprint

- HUs completadas: WAS-70, WAS-73, WAS-74 (+ Fase 2)
- Sub-agentes en paralelo: 3
- Migraciones pendientes de aplicar en prod: 2 (027, 028)

---

## Notas del Tech Lead

> *"El patrón Critical Constraints funciona. Los agentes que leen antes de modificar toman mejores decisiones. Hay que reforzarlo como estándar en todos los SDDs."*
> — San, Tech Lead Sprint 13

---

*Documento generado por NexusAgil Scrum Master. Para aprobar: responder `RETRO_APPROVED`.*
