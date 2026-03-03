# Sprint 17 Retrospectiva — WasiAI v2

**Fecha:** 2026-03-03  
**Scrum Master:** San (NexusAgil QUALITY mode)  
**Formato:** Start / Stop / Continue → Acciones concretas Sprint 18  
**Participantes:** Fer + San (SM)

---

## ✅ Qué salió bien

1. **Velocity completa al 100% — incluyendo los dos stretch**  
   WAS-72 y WAS-41 eran riesgo real (21 SP extra). Se completaron porque WAS-89 fue desbloqueado rápido y creó el runway para el resto. El orden de ejecución del planning resultó correcto.

2. **Auto-blindaje BUG-01 aplicado en tiempo real**  
   El bug de navegación client-side fue detectado, y en lugar del fix directo, se escribió el test Playwright primero. Esto creó cobertura duradera y validó el nuevo protocolo antes de que fuera formal. San aprobó — ahora es regla permanente.

3. **Adversarial Reviews limpios — 0 BLOQUEANTEs en todo el sprint**  
   Primer sprint con esta métrica en cero. La combinación de Codebase Grounding profundo en F0 + Story Files autocontenidos redujo drásticamente el drift en F3.

4. **Plugin LlamaIndex — primer ecosistema externo validado**  
   `llama-index-wasiai` publicado y funcional en beta. Abre un canal de distribución nuevo: developers externos pueden usar agentes WasiAI sin conocer el stack interno. Hito estratégico.

5. **Suite Playwright 35/35 — primera vez con cobertura total de flows críticos**  
   La suite ahora cubre: marketplace, pagos, escrow, CLI y navegación. Puede correr en CI sin supervisión. Deuda de QA automatizado del stack blockchain/frontend prácticamente eliminada este sprint.

---

## ⚠️ Qué salió mal

1. **BUG-03 — autoRelease timer con offset de 6h por timezone**  
   Error de infraestructura evitable. El contrato asumía UTC pero el backend procesaba en CST. No había un checklist de env vars ni de timezone entre contrato y servidor. Tomó medio día diagnosticar. **Costo real: ~4h de debugging.**

2. **BUG-02 — CLI `--format json` retorna string en lugar de objeto**  
   El contrato de integración entre CLI y el agent endpoint no especificó el tipo de retorno con suficiente detalle. El story file decía "retorna el resultado como string" — ambiguo. La serialización fue inconsistente entre agentes que retornan texto plano vs JSON embebido.

3. **WAS-72 (Escrow) casi no entra al sprint — dependencias en cadena subestimadas**  
   WAS-72 dependía de WAS-89 + WAS-103 + WAS-82. En los primeros 3 días del sprint, WAS-82 tuvo un rebloqueo temporal por inestabilidad de Chainlink Automation en Fuji. WAS-72 estuvo en riesgo hasta el día 6. Entramos con 2 días de margen.

4. **MockUSDC requirió reescritura completa — no actualización**  
   En el planning se asumió "actualización" de MockUSDC. Al hacer Codebase Grounding en F2, resultó que la arquitectura original era incompatible con ERC-3009 real y requirió reescritura desde cero. Esto se anticipó como riesgo en el planning, pero no se tradujo en SP buffer. WAS-89 consumió los 5 SP justos sin margen.

---

## 💡 Acciones Sprint 18

1. **Formalizar checklist de env vars antes de cada deploy**  
   Crear `doc/deploy-checklist.md` con lista de verificación: timezone UTC, variables de prod vs staging, addresses on-chain por red, secrets en Vercel sincronizados. El SM (San) valida el checklist antes de aprobar cualquier merge que toque contratos o variables de entorno.

2. **Playwright como requisito de entrada para bugs de navegación**  
   A partir de Sprint 18, cualquier bug reportado de navegación client-side requiere un test Playwright que lo reproduzca antes de abrir el fix. Sin test reproducible = bug no entra al sprint. SM registra en Linear como subtask del issue.

3. **Contratos de integración deben incluir tipos exactos de retorno**  
   En todos los story files que involucren CLI, API endpoints o plugins, el "Contrato de integración" debe especificar: tipo TypeScript del retorno, ejemplo JSON real, y comportamiento en error. No strings ambiguos. El Adversary lo valida en review.

---

## 🧠 Auto-Blindajes — Activos post Sprint 17

Lista completa de blindajes permanentes aprobados para WasiAI v2:

| # | Blindaje | Origen | Aprobado por |
|---|---------|--------|-------------|
| 1 | `ethers.js → siempre versión explícita en story file` (nunca implícita, preferir viem) | Sprint 15 | San |
| 2 | `Commits atómicos obligatorios` — un commit por cambio lógico, no acumular | Sprint 15 | San |
| 3 | `Env vars de prod verificadas antes de cada deploy` — checklist doc/deploy-checklist.md | Sprint 17 BUG-03 | San |
| 4 | `Plan de infraestructura validado en SDD` — timezones, redes, endpoints explícitos | Sprint 17 BUG-03 | San |
| 5 | `Bugs de navegación client-side → escribir test Playwright primero, luego fix` | Sprint 17 BUG-01 | **San ✅ APROBADO** |

> **Blindaje #5 aprobado explícitamente por San en Sprint 17.**  
> Nunca más fix-first en navegación. Test-first always.

---

## Kaizen — Mejoras de proceso permanentes

- **Story files deben incluir tipos TypeScript de retorno en el contrato de integración** (no solo descriptions)
- **MockUSDC / mocks on-chain: evaluar compatibilidad en F2 Codebase Grounding** antes de estimar SP — no en F3
- **Chainlink Automation en Fuji**: siempre tener trigger manual como fallback documentado en el story file

---

## Métricas de Retro

| Categoría | Sprint 16 | Sprint 17 | Δ |
|-----------|-----------|-----------|---|
| SP completados | 37 | 42 | +5 ✅ |
| Bugs post-sprint | 6 | 4 | -2 ✅ |
| Adversarial BLOQUEANTEs | 2 | 0 | -2 ✅ |
| Playwright suite coverage | parcial | 35/35 ✅ | +completo |
| Auto-blindajes activos | 2 | 5 | +3 |

---

*Retrospectiva generada por San (NexusAgil SM) — 2026-03-03 — Sprint 17 CERRADO*
