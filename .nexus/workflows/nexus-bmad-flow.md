# WasiAI — Flujo Nexus + BMAD

```
BACKLOG
  │
  ▼
IDEA / HU cruda
  │
  ▼
[S0 — Analyst]
  · Elicitación (máx 5 preguntas)
  · HU + AC + Scope + Notas
  │
  ▼
⛔ GATE 1: HU_APPROVED: yes  ← Fer aprueba
  │
  ▼
[S1 — SDD Generator]
  · Rutas API
  · Schema DB + RLS
  · Interacciones on-chain
  · Componentes UI
  · Flujos + Edge Cases
  · Definition of Done
  │
  ▼
⛔ GATE 2: SPEC_APPROVED: yes  ← Fer aprueba
  │
  ▼
[S2 — Implementación]
  · Siguiendo Golden Path
  · Sin desviaciones
  · DoD verificado
  │
  ▼
ENTREGADO ✅
```

---

## Comandos

```
# Arrancar una HU nueva
"lee .nexus/skills/S0-idea-to-hu.md — quiero trabajar [nombre o descripción de la HU]"

# Generar SDD desde HU aprobada
"lee .nexus/skills/S1-hu-to-sdd.md — [pega la HU aprobada]"

# Ver el Golden Path
"lee .nexus/workflows/golden-path.md"
```

---

## Reglas del sistema

1. Sin `HU_APPROVED` no hay SDD
2. Sin `SPEC_APPROVED` no hay código
3. El Golden Path no se negocia en cada feature
4. Todo documento generado se persiste en `.nexus/docs/`
5. Una HU a la vez — no mezclar features en un mismo SDD
