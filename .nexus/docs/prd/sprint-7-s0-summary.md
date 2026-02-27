# Sprint 7 — S0 Summary (Para revisión de Fer)
## WasiAI · BMAD Method v6
**Fecha:** 2026-02-27  
**Generado por:** PM John (BMAD)  
**Sprint:** Wallet UX & Marketplace Polish

---

## Estado de los S0

Los 6 archivos S0 han sido generados. Fer debe leer cada uno y dar **HU_APPROVED** explícito para cada HU que apruebe.

> ⚠️ "Go" o "dale" NO equivale a HU_APPROVED. Cada gate requiere aprobación explícita.

---

## Resumen de las 6 HUs

| ID | Título | Prioridad | Estimación | Dependencias | Archivo |
|----|--------|-----------|------------|--------------|---------|
| WAS-45 | Wallet connect/disconnect en WasiNavBar | P1 | S | Ninguna | [WAS-45-s0.md](./WAS-45-s0.md) |
| WAS-46 | BUG: Pay button conecta wallet | P0 🔴 | XS | **WAS-45** | [WAS-46-s0.md](./WAS-46-s0.md) |
| WAS-47 | "Ver agentes" scroll en home | P3 | XS | Ninguna | [WAS-47-s0.md](./WAS-47-s0.md) |
| HU-9.1 | Empty state búsqueda sin resultados | P2 | S | Ninguna | [HU-9.1-s0.md](./HU-9.1-s0.md) |
| HU-9.2 | Preview live en /publish | P2 | M | Ninguna | [HU-9.2-s0.md](./HU-9.2-s0.md) |
| HU-4.2 | Filtros avanzados marketplace (solo UI) | P2 | M | Ninguna | [HU-4.2-s0.md](./HU-4.2-s0.md) |

**Carga total:** 2×XS + 2×S + 2×M → estimación razonable para una semana

---

## Orden de implementación sugerido

```
1. WAS-45  (S)  → Crea WalletConnectModal reutilizable
2. WAS-46  (XS) → Fix P0, reutiliza modal de WAS-45
3. WAS-47  (XS) → Rápido e independiente
4. HU-9.1  (S)  → Empty state, solo UI
5. HU-4.2  (M)  → Filtros avanzados marketplace
6. HU-9.2  (M)  → Preview live en /publish
```

---

## Riesgos más importantes del sprint

1. **WAS-45 → WAS-46 (dependencia dura):** WAS-46 no puede implementarse sin WAS-45. Si WAS-45 se bloquea, WAS-46 también.
2. **HU-9.2 — PublishForm como Server Component:** Riesgo de refactoring; puede requerir más tiempo que M si la arquitectura actual lo complica.
3. **WAS-45 — SSR con wagmi:** Requiere cuidado con `'use client'` en navbar.

---

## Lo que Fer debe hacer ahora

Para cada HU, Fer lee el S0 correspondiente y escribe:

```
HU_APPROVED: WAS-45
HU_APPROVED: WAS-46
HU_APPROVED: WAS-47
HU_APPROVED: HU-9.1
HU_APPROVED: HU-9.2
HU_APPROVED: HU-4.2
```

O indica ajustes al scope antes de aprobar.

Con los HU_APPROVED → Bob (SM) genera los story files individuales → S1 (SDD + Implementation Readiness Check) → SPEC_APPROVED → Dev implementa.

---

*Generado por PM John (BMAD Method v6) · 2026-02-27*
