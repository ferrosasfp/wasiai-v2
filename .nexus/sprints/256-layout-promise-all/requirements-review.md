# Requirements Review — WAS-256 — Layout Promise.all (FAST-FIX)

**Fecha:** 2026-03-20
**Reviewer:** Requirements Reviewer — NexusAgil v1.3

---

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | Calidad AC | MEDIA | AC4: "error SHALL propagate normally" no es testeable. No especifica a dónde propaga (Next.js error boundary, llamador del layout, etc.) ni si ambos errores independientes son capturados o solo el primero. | Redactar: "IF either call throws, the error SHALL propagate to the nearest Next.js error boundary without being swallowed." |
| F2 | Calidad AC | BAJA | AC3: "render correctly" no es verificable. No define qué constituye "correcto" — podría especificar que `messages` y `user` estén disponibles para sus respectivos consumidores. | Reformular: "WHEN parallel calls complete, messages SHALL be passed to NextIntlClientProvider AND user SHALL be passed to WasiNavBar and BottomTabBar as initialEmail." |
| F3 | Cobertura paths | BAJA | No hay AC para el caso donde `getMessages()` resuelve pero `createClient()` falla. El comportamiento esperado (¿la página carga sin sesión? ¿lanza error total?) no está definido. | Incluir en AC4 o agregar AC6 cubriendo fallo parcial. |
| F4 | Código actual | INFO | El código actual ya tiene `supabase` disponible antes de `getUser()` — la dependencia de orden es correcta. No hay conflicto de implementación. El fix es directo. | — |
| F5 | Scope | BAJA | El Scope OUT no menciona explícitamente que NO se debe alterar el orden de los parámetros desestructurados del Promise.all result. Un implementador podría invertir el orden y romper silenciosamente. | Agregar nota al Scope IN: "el resultado de Promise.all SHALL desestructurarse como `[messages, supabase]` en ese orden." |

### ACs sugeridos

```
- AC4 (revisado): IF either getMessages() or createClient() throws, the error SHALL propagate
  to the nearest Next.js error boundary without being swallowed by the Promise.all wrapper.
- AC6 (nuevo): WHEN Promise.all resolves, the destructured values SHALL maintain order
  [messages, supabase] matching the input array order.
```

### Veredicto

**NECESITA CAMBIOS MENORES** — AC4 no es testeable en su forma actual; AC3 necesita criterio verificable. Los demás findings son menores. El scope y la cobertura del happy path son adecuados para un FAST-FIX.
