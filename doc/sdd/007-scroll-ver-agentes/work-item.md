# Work Item #007 — WAS-47: Botón "Ver agentes" hace scroll al catálogo

| Campo | Valor |
|-------|-------|
| **#** | 007 |
| **Linear** | WAS-47 |
| **Tipo** | improvement |
| **SDD_MODE** | mini |
| **Objetivo** | El botón "Ver agentes" (o "Browse agents") en el hero de la homepage debe hacer scroll suave hasta la sección del catálogo de agentes en lugar de no hacer nada o navegar a otra página. |
| **Reglas de negocio** | El scroll debe ser suave (smooth). El botón ya existe en la UI — solo cambiar su comportamiento. No requiere nueva ruta ni nueva página. |
| **Scope IN** | Hero section en homepage. El botón CTA existente. |
| **Scope OUT** | Catálogo de agentes. Navbar. Otras páginas. |

## Acceptance Criteria

| # | AC | Formato EARS |
|---|---|---|
| 1 | WHEN el usuario hace click en "Ver agentes" / "Browse agents", THE página SHALL hacer scroll suave hasta la sección de agentes | |
| 2 | WHEN el scroll termina, THE catálogo de agentes SHALL ser visible en el viewport | |
