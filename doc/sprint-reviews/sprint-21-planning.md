# Sprint 21 Planning — "Agente a Agente"
**Fecha:** 2026-03-03
**SM:** San 🌙

---

## Sprint anterior — S20 "Modelo Económico"

| HUs completadas | HUs en progreso | HUs abortadas |
|-----------------|-----------------|---------------|
| 5 | 0 | 0 |

**Velocidad S20:** 5 HUs (2L + 2M + 1S) en ~1 día
**Velocidad S19:** 7 HUs | **S18:** 5 HUs

---

## Backlog priorizado

| Linear | HU | Tipo | Tamaño | SDD_MODE | Prioridad |
|--------|-----|------|--------|----------|-----------|
| WAS-136 | Flash "red incorrecta" Core Wallet en home | Bug | S | FAST | P3 |
| WAS-138 | Fix 10 tests fallando — settle-key-batches + trial | Bug | M | QUALITY | P2 |
| WAS-137 | Edit agent — campos faltantes (capabilities, agent_type, MCP) | Feature | M | QUALITY | P2 |
| WAS-139 | Vista pública creator_public_profiles (RLS read) | Feature | S | FAST | P3 |
| WAS-140 | Pagos autónomos agente→agente (WAS-71 Fase 2) | Feature | XL | QUALITY | P2 |

---

## Capacidad del sprint

- **Duración:** 1 semana
- **Referencia velocidad:** S20 = 5 HUs · S19 = 7 HUs · S18 = 5 HUs
- **Target:** 5 HUs (2S + 2M + 1XL)
- **Nota:** WAS-140 (XL) es el entregable principal del Build Games Semana 2

---

## Selección propuesta

| Orden | Linear | HU | Tamaño | Justificación |
|-------|--------|-----|--------|---------------|
| 1 | WAS-136 | Flash red incorrecta Core Wallet | S | Quick win, primera impresión de nuevos usuarios |
| 2 | WAS-138 | Fix tests fallando | M | Deuda técnica — CI en rojo es señal de alerta |
| 3 | WAS-137 | Edit agent campos faltantes | M | UX crítico para creators reales |
| 4 | WAS-139 | Vista pública creator_public_profiles | S | Rápido, habilita perfiles públicos |
| 5 | WAS-140 | Pagos autónomos agente→agente — **MVP Fuji, 1 hop** | XL | Core Build Games S2 — scope limitado a Fuji + 1 salto. Mainnet diferido. |

---

## Contexto Build Games

**Semana 2** (debería tener): Mainnet + AgentKit + 3 creadores reales
**Estado real:** WAS-140 (agente→agente) es el MVP del flujo agéntico — prioridad máxima

---

**Esperando aprobación de Fer. Escribe exactamente:** `SPRINT_APPROVED`
