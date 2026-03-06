# Work Item #001 — [BUG] Navbar desktop: saldo USDC invisible

> Fecha: 2026-02-27
> Tipo: bugfix
> SDD_MODE: bugfix
> Branch: fix/001-navbar-usdc-invisible
> Artefactos: doc/sdd/001-navbar-usdc-invisible/

---

## Work Item #001

| Campo | Valor |
|-------|-------|
| **#** | 001 |
| **Tipo** | bugfix |
| **SDD_MODE** | bugfix |
| **Objetivo** | Corregir la visibilidad del componente `ApiKeyBalance` en la navbar desktop para que el saldo USDC se muestre correctamente sin blur ni transparencia, eliminando la condición de race condition en auth state que lo oculta. |
| **Actual vs Esperado** | **Actual:** Entre el tab Docs y el selector EN\|ES aparecen bloques borrosos/difuminados. El componente `ApiKeyBalance` existe en el DOM pero es invisible (elemento fantasma — sin color, con blur o opacity 0). **Esperado:** El saldo USDC se muestra legible en la navbar desktop cuando el usuario está autenticado, sin distorsión visual ni estados intermedios visibles. |
| **Scope IN** | Fix de visibilidad CSS en `ApiKeyBalance` y/o corrección del estado de montaje en `WasiNavBar.tsx`; eliminación de cualquier clase blur/transparent aplicada incorrectamente. |
| **Scope OUT** | Rediseño de la navbar, cambios al flujo de autenticación, modificaciones a la lógica de cálculo del saldo, otros componentes de la navbar. |
| **Missing Inputs** | N/A |

---

## Acceptance Criteria (EARS)

1. **WHEN** el usuario autenticado carga cualquier página con navbar desktop, **THE** componente `ApiKeyBalance` **SHALL** mostrar el saldo USDC con texto legible y sin efectos visuales de blur, transparencia o difuminado.

2. **WHILE** el auth state está cargando (estado de hidratación), **THE** navbar **SHALL** mostrar un skeleton/placeholder neutral en lugar de un bloque difuminado visible para el usuario.

3. **IF** el componente `ApiKeyBalance` recibe datos de saldo en `undefined` o `null` durante hidratación, **THEN THE** componente **SHALL** renderizar `$0.00` o un estado de loading, nunca un bloque borroso visible.

4. **WHEN** el usuario no está autenticado, **THE** navbar **SHALL** omitir el componente `ApiKeyBalance` completamente, sin dejar espacio fantasma ni artefactos visuales.

---

## Repro Steps

1. Abrir la app en desktop (viewport ≥ 1024px)
2. Estar autenticado (o no autenticado)
3. Observar el área entre el tab "Docs" y el selector EN|ES en la navbar
4. **Actual:** Se ven bloques borrosos/difuminados; el saldo USDC no es visible

---

## Archivos probables

| Archivo | Rol probable |
|---------|-------------|
| `src/components/WasiNavBar.tsx` | Orquesta la navbar — puede estar aplicando CSS incorrecto o condicional de render mal |
| `src/features/layout/components/ApiKeyBalance.tsx` | Componente del saldo — puede tener className con blur/transparent o hidratación incorrecta |

---

## Sizing

| Dimensión | Estimación |
|-----------|-----------|
| Archivos a modificar | 1–2 |
| Complejidad | Baja–Media |
| Esfuerzo estimado | 2–4 horas |
| Riesgo de regresión | Bajo (solo visual) |

---

*Work Item generado por NexusAgil — Analyst + Architect — Sprint 9*
