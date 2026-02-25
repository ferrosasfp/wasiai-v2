# HU-1.3 — Test de endpoint en tiempo real

> **Estado:** HU_APPROVED ✅
> **Linear:** WAS-7
> **Sprint:** 1 (25 Feb – 1 Mar 2026)
> **Épica:** 1 — Creators Reales

---

## Historia de Usuario

Como **creator** que está llenando el formulario de publicación,
quiero poder probar mi endpoint directamente desde el paso 3 antes de publicar,
para verificar que WasiAI puede alcanzarlo y que responde correctamente, sin tener que publicar y probar manualmente.

---

## Criterios de Aceptación

- [ ] **AC1:** En el paso 3 del formulario, junto al campo `endpoint_url`, hay un botón "Probar endpoint".
- [ ] **AC2:** Al hacer click, el backend envía `POST {endpoint_url}` con body `{"input": "test"}` y el `auth_header` configurado (si existe).
- [ ] **AC3:** Si el endpoint responde 2xx → muestra ✅ "OK · {latencia}ms"
- [ ] **AC4:** Si el endpoint responde 4xx/5xx → muestra ⚠️ "Error {status_code}"
- [ ] **AC5:** Si el endpoint no responde en 5 segundos → muestra ❌ "No alcanzable (timeout)"
- [ ] **AC6:** El test pasa por el backend de WasiAI con SSRF protection — nunca desde el browser directamente.
- [ ] **AC7:** Botón con spinner durante el test, desactivado para evitar doble click.

---

## Scope

**IN:**
- `POST /api/creator/test-endpoint` (nuevo) con auth + rate limiting + SSRF
- Botón "Probar" en `Step3Technical`
- Estados visuales: ✅ OK / ⚠️ Error / ❌ No alcanzable
- Timeout 5 segundos
- Auth header incluido si está configurado

**OUT:**
- Payload configurable por el creator
- Mostrar cuerpo completo de la respuesta
- Auto-test con debounce al escribir URL
- Historial de tests

---

## Notas del Analyst

- **Dependencias:** HU-1.2 completada ✅ — Step3Technical ya existe
- **Riesgo:** SSRF — usar `validateEndpointUrl` existente sin modificar
- **UX:** Agregar nota "El timeout de producción puede variar" debajo del resultado

---

*Aprobada por Fer — 2026-02-25*
