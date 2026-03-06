# Sprint 4 Planning — WasiAI v2
> Artefacto generado por SM (BMAD v6) | 2026-02-28
> **Estado:** Pendiente revisión y aprobación de Fer

---

## 1. Sprint Goal

> **"Demostrar en Fuji que WasiAI puede orquestar múltiples agentes IA en pipeline, pagando cada paso on-chain — listo para la evaluación de la Semana 3 del hackathon."**

El sprint es exitoso si `POST /api/v1/compose` está desplegado en Fuji con al menos 3 agentes DeFi Risk ejecutando en cadena y cobrando x402 por step.

---

## 2. Sprint Duration

| | |
|---|---|
| **Inicio** | Sábado 28 Feb 2026 — 14:00 CST |
| **Fin** | Viernes 6 Mar 2026 — 23:59 CST |
| **Duración** | 7 días |
| **Contexto** | Semana 3 del hackathon Avalanche Build Games |
| **Compromiso inamovible** | `/api/v1/compose` funcionando en Fuji antes del cierre de semana |

---

## 3. Capacidad del Equipo

| Miembro | Rol | Disponibilidad | Horas Sprint |
|---------|-----|---------------|-------------|
| **Fer** | Product Owner + Review | 8-10h/día × 7 días | ~63-70h |
| **San** | SM + Dev + Arch + QA (AI) | Paralelo ilimitado | Sin límite de horas — limitada por gates |

**Capacidad efectiva de Fer por stream:**
- Stream A reviews/decisions: ~30h
- Stream B reviews/decisions: ~30h
- Tiempo para gates + lecturas de artefactos: ~5-10h

**Nota crítica:** Los gates son el cuello de botella real del sprint, no la capacidad de San.
San puede ejecutar ambos streams en paralelo — pero cada gate requiere que **Fer lea y apruebe explícitamente**.

---

## 4. Issues Seleccionados del Backlog

### Issues del Sprint 4

| Issue | HU | Prioridad | Estimación | Stream | Justificación |
|-------|----|-----------|-----------|--------|--------------|
| **WAS-19** | HU-5.1 Compose API síncrono | 🔴 P0 | 4 días | A | Compromiso inamovible Semana 3. El hackathon se evalúa por esto. |
| **WAS-69** | HU-7.6 DeFi Risk Pipeline (5 agentes) | 🔴 P0 | 5.5 días | B | Los agentes son el contenido del compose demo. Sin agentes reales, la demo está vacía. |
| **WAS-68** | Sentry error tracking | 🟡 P2 | 1 día | A | Quick win. Sin gates pendientes. Mejora observabilidad para debugging del sprint mismo. |

### Issues EXCLUIDOS del Sprint 4

| Issue | Razón de exclusión |
|-------|--------------------|
| WAS-22 Mainnet deploy | Bloqueado por WAS-21 (auditoría contrato). No toca este sprint. |
| WAS-21 Auditoría contrato | Requiere planificación propia. Post-hackathon o Sprint 5. |
| WAS-70 HU-5.1b Async | Explícitamente out of scope en HU-5.1. Roadmap post-hackathon. |

---

## 5. Streams Paralelos

### 🔵 Stream A — WasiAI Core (Compose API)

**Objetivo:** `POST /api/v1/compose` desplegado y funcional en Fuji.

**Responsable primario:** San (Dev) + Fer (gates + review)

| Fase | Tarea | Días | Dependencia |
|------|-------|------|-------------|
| **GATE 1** | Fer escribe `HU_APPROVED` para HU-5.1 | Día 1 (hoy) | Fer lee hu-compose-draft.md |
| **S1 — SDD** | San genera SDD de HU-5.1 (rutas, schema, migration 017) | Día 1-2 | HU_APPROVED |
| **GATE 2** | Fer escribe `SPEC_APPROVED` para HU-5.1 | Día 2 | Fer lee SDD |
| **Story File** | SM genera story-HU-5.1.md autocontenido | Día 2 | SPEC_APPROVED |
| **Dev — Migration** | Migration 017: columns `pipeline_id`, `step_index` en `agent_calls` | Día 3 | Story file |
| **Dev — Backend** | Endpoint `POST /api/v1/compose` + orquestador secuencial + preflight | Día 3-4 | Migration |
| **Dev — Integración** | Rate limiting Upstash + SSRF + receipts firmados por step | Día 4 | Backend |
| **Adversarial Review** | AR sobre el endpoint completo (race conditions, SSRF, auth bypass) | Día 4-5 | Dev completo |
| **QA** | Verificar cada AC (1-10) contra código real en Fuji | Día 5 | AR limpio |
| **Deploy** | `git push origin master master:main` → Vercel → Fuji | Día 5-6 | QA ✅ |
| **Sentry (WAS-68)** | Configurar Sentry en proyecto — sin gates | Día 6-7 | Paralelo |

### 🟠 Stream B — Agentes I+D (DeFi Risk Pipeline)

**Objetivo:** 5 agentes DeFi Risk publicados en marketplace Fuji, ejecutables individualmente y en pipeline.

**Responsable primario:** San (I+D) + Fer (gates + review)

| Fase | Tarea | Días | Dependencia |
|------|-------|------|-------------|
| **GATE 1** | Fer escribe `HU_APPROVED` para HU-7.6 | Día 1 (hoy) | Fer lee hu-defi-risk-agents-draft.md |
| **Verificación Kite AI** | San verifica disponibilidad API Kite AI o define fallback | Día 1 | — |
| **S1 — SDD** | San genera SDD HU-7.6 (arquitectura 5 agentes, schema, scoring) | Día 1-2 | HU_APPROVED + Kite AI status |
| **GATE 2** | Fer escribe `SPEC_APPROVED` para HU-7.6 | Día 2 | Fer lee SDD |
| **Story File** | SM genera story-HU-7.6.md autocontenido | Día 2 | SPEC_APPROVED |
| **Dev — Agent 1** | Chainlink Price Feed Reader (Fuji AVAX/USD + histórico 7d) | Día 3 | Story file |
| **Dev — Agent 2** | On-Chain Analyzer (holders, concentration, flags) | Día 3-4 | Story file |
| **Dev — Agent 3** | Kite AI Contract Auditor (o fallback LLM) | Día 3-4 | Kite AI verificado |
| **Dev — Agent 4** | Sentiment Analyzer (metadata on-chain/marketplace) | Día 4 | Story file |
| **Dev — Agent 5** | Risk Report Generator (score 0-100, SAFE/CAUTION/AVOID) | Día 4-5 | Agents 1-4 output schemas |
| **Publicación** | Registro en DB marketplace + fees x402 funcionales | Día 5 | Todos los agentes |
| **Adversarial Review** | AR sobre los 5 endpoints (inputs externos, SSRF, RPC confianza) | Día 5 | Dev completo |
| **QA** | Verificar ACs 1-8 contra código. Pipeline end-to-end con 2 tokens. | Día 5-6 | AR limpio |
| **Demo prep** | Pipeline compose con los 5 agentes encadenados — demo Semana 3 | Día 6-7 | Stream A + B ✅ |

---

## 6. Dependencias entre Issues

```
HU_APPROVED HU-5.1  →  SDD HU-5.1  →  SPEC_APPROVED  →  story-HU-5.1.md  →  Dev WAS-19
                                                                                     ↑
HU_APPROVED HU-7.6  →  [Kite AI verify]  →  SDD HU-7.6  →  SPEC_APPROVED  →  story-HU-7.6.md  →  Dev WAS-69
                                                                                                          ↓
                                                                          WAS-69 Agents publicados  →  Demo compose
                                                                                                     (Stream A + B juntos)

WAS-68 (Sentry) → sin dependencias → paralelo desde Día 6
```

**Dependencia crítica de demo:** La demo del hackathon requiere Stream A (compose) + Stream B (agentes) completos. Si uno se atrasa, el otro no puede demostrar el caso de uso completo. Ambos streams deben converger en Día 6-7.

---

## 7. Definición de Done del Sprint

El Sprint 4 está done cuando **todos** los siguientes criterios son true:

### WAS-19 (HU-5.1 Compose API)
- [ ] `POST /api/v1/compose` responde en Vercel prod (https://wasiai-v2.vercel.app)
- [ ] Pipeline de 3 agentes ejecuta en Fuji con pagos x402 reales por step
- [ ] Migration 017 aplicada en Supabase producción
- [ ] Todos los ACs 1-10 del story file verificados por QA ✅
- [ ] Adversarial Review sin items BLOQUEANTE
- [ ] `forge test` pasa (si hay cambios en contrato — en este caso no debería haber)
- [ ] `npm run build` → 0 errores TypeScript
- [ ] `git push origin master master:main` ejecutado

### WAS-69 (HU-7.6 DeFi Risk Pipeline)
- [ ] 5 agentes registrados y activos en marketplace Fuji (status: active)
- [ ] Agent 1 retorna precio real de Chainlink (AVAX/USD en Fuji)
- [ ] Agent 2 retorna data on-chain real de Avalanche RPC
- [ ] Agent 3 conecta a Kite AI (o fallback documentado y aprobado por Fer)
- [ ] Agent 5 calcula score 0-100 con fórmula documentada, determinístico (±3 pts)
- [ ] Pipeline end-to-end < 60 segundos con 2 tokens distintos
- [ ] ACs 1-8 del story file verificados por QA ✅
- [ ] Adversarial Review sin items BLOQUEANTE

### WAS-68 (Sentry)
- [ ] Sentry inicializado, capturando errores en producción
- [ ] Al menos 1 error de prueba capturado y visible en dashboard Sentry

### Sprint completo
- [ ] Demo preparada: pipeline compose con los 5 agentes DeFi Risk, grabable para el hackathon
- [ ] Ningún secret en NEXT_PUBLIC_
- [ ] Ningún dato simulado en producción
- [ ] sprint-status.yaml actualizado

---

## 8. Riesgos del Sprint

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|--------|-------------|---------|-----------|
| **R1** | Gates bloqueados — Fer no tiene tiempo para leer 2 SDDs en Día 1-2 | Alta | Crítico | Los drafts S0 ya existen. Gates pueden activarse hoy mismo si Fer los lee ahora. Prioridad máxima antes de cualquier otra tarea. |
| **R2** | Timeout 25s de Vercel con pipeline de 5 agentes lentos | Alta | Alto | Limitar compose a 5 steps; documentar latencia esperada. Agents DeFi tienen límite de 10s (AC-3). Si falla en demo, reducir a 3 agentes. |
| **R3** | Kite AI sin API pública disponible | Alta | Alto | Verificar el Día 1. Fallback: LLM con prompt de auditoría (Claude/GPT). Documentar como deuda técnica. La demo sigue funcionando. |
| **R4** | Race condition en saldo de key en compose | Media | Alto | Implementar desde el inicio con Redis lock o atomic check (patrón HAL-011). No parchear después. |
| **R5** | Streams A y B no convergen para la demo | Media | Alto | Tracking diario. Si el Día 5 algún stream está atrasado, Fer y San deciden qué simplificar (demo con 2 agentes en lugar de 5 si es necesario). |
| **R6** | Chainlink feeds no disponibles para tokens relevantes en Fuji | Media | Medio | Usar AVAX/USD y ETH/USD que tienen feeds confirmados en Fuji. Documentar limitación en marketplace. |
| **R7** | Adversarial Review bloqueante en Día 4-5 | Baja | Alto | AR se ejecuta con mentalidad adversarial desde el inicio del dev, no como afterthought. Patrones de seguridad (validateUrl, ratelimit, auth) son parte del story file. |

---

## 9. Gates de Aprobación de Fer

### Gates inmediatos (HOY — Día 1)

| Gate | Artefacto a leer | Texto exacto requerido | ETA respuesta |
|------|-----------------|----------------------|---------------|
| **GATE 1 — HU-5.1** | `/wasiai-v2/hu-compose-draft.md` | `HU_APPROVED` | Hoy, Día 1 |
| **GATE 1 — HU-7.6** | `/wasiai-v2/hu-defi-risk-agents-draft.md` | `HU_APPROVED` | Hoy, Día 1 |

⚠️ **Bloqueante crítico:** Sin estos dos gates hoy, el Sprint 4 pierde 1-2 días y el compromiso de Semana 3 está en riesgo.

### Gates de Spec (Día 2)

| Gate | Artefacto a leer | Texto exacto requerido | ETA entrega |
|------|-----------------|----------------------|-------------|
| **GATE 2 — HU-5.1** | `sdd-HU-5.1.md` (San lo genera tras HU_APPROVED) | `SPEC_APPROVED` | Día 2 AM |
| **GATE 2 — HU-7.6** | `sdd-HU-7.6.md` (San lo genera tras HU_APPROVED) | `SPEC_APPROVED` | Día 2 PM |

### Gates de validación (Día 5-6)

| Gate | Qué hace Fer | Texto exacto | ETA |
|------|-------------|-------------|-----|
| **Review Compose** | Lee el output del QA de HU-5.1. Si todo está ✅, confirma deploy. | Aprobación de deploy | Día 5-6 |
| **Review Agentes** | Lee el output del QA de HU-7.6. Prueba el pipeline end-to-end manualmente. | Aprobación de deploy | Día 6 |

### Resumen de tiempos críticos

```
Día 1 (Hoy):
  10:00 → Fer lee hu-compose-draft.md → escribe HU_APPROVED
  11:00 → Fer lee hu-defi-risk-agents-draft.md → escribe HU_APPROVED
  11:00+ → San genera ambos SDDs en paralelo
  
Día 2:
  AM → Fer lee SDD HU-5.1 → escribe SPEC_APPROVED
  PM → Fer lee SDD HU-7.6 → escribe SPEC_APPROVED
  PM → San genera story-HU-5.1.md y story-HU-7.6.md

Día 3-5: Dev en paralelo (San ejecuta, Fer disponible para preguntas)

Día 5-6: Fer revisa QA reports y aprueba deploy final

Día 7: Demo lista para el hackathon
```

---

## Notas del SM

1. **Prioridad absoluta de hoy:** Los dos gates de HU_APPROVED. Todo lo demás puede esperar.
2. **No se codea nada sin story file.** La regla no tiene excepciones, ni en hackathon.
3. **"Go", "Dale", "Sí"** ≠ gate. Los gates requieren el texto exacto.
4. **Si Kite AI no tiene API pública**, San define el fallback en el SDD y Fer lo aprueba en GATE 2 — no se bloquea el sprint.
5. **WAS-68 (Sentry)** no requiere gate — San lo implementa en paralelo durante Día 6-7 cuando los streams principales están en QA.

---

*Sprint 4 Planning generado por SM (San) — 2026-02-28 14:16 CST*
*BMAD v6 | Nexus Factory | WasiAI v2*
