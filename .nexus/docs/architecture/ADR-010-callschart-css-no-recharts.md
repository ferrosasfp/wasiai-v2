# ADR-010 — CallsChart con barras CSS (sin recharts)

**Fecha:** 2026-02-25  
**Estado:** Aceptado  
**Sprint:** 2 (HU-1.4 Creator Analytics)

---

## Contexto

Para el dashboard de analytics del creator (HU-1.4), necesitábamos mostrar una gráfica de llamadas por día en los últimos 30 días.

Opciones:
- **recharts**: Librería React para gráficas. Completa, pero añade ~200KB al bundle.
- **CSS bars**: Barras verticales con `div` + Tailwind. Sin dependencias nuevas, implementación de ~30 líneas.

---

## Decisión

**CSS bars con Tailwind** — sin recharts.

---

## Razones

1. **Cero dependencias nuevas**: El bundle de Next.js ya es pesado. Cada librería nueva requiere justificación.
2. **Velocidad de entrega**: La gráfica CSS se implementó en 30 minutos. recharts habría requerido configuración de SSR, tipos, theme.
3. **Suficiente para el MVP**: Los creators necesitan ver tendencias, no análisis financiero. Barras CSS comunican lo mismo.
4. **Fácil de mantener**: Cualquier dev que conozca Tailwind puede modificar la gráfica.

---

## Consecuencias

- `CallsChart` renderiza barras `div` con `height` calculado como porcentaje del máximo del período.
- Sin tooltips interactivos en esta versión.
- Si en futuras épicas se necesitan gráficas más complejas (E8 Transparencia), se evalúa recharts o similar en ese momento.

---

## Archivos afectados

- `src/features/creator/components/CallsChart.tsx`
- `src/app/[locale]/creator/dashboard/page.tsx`
