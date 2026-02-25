# HU-1.2 — Formulario multi-paso con preview live

> **Estado:** HU_APPROVED ✅
> **Linear:** WAS-6
> **Sprint:** 1 (25 Feb – 1 Mar 2026)
> **Épica:** 1 — Creators Reales

---

## Historia de Usuario

Como **creator** que quiere publicar un agente,
quiero un formulario dividido en 3 pasos (básico → producto → técnico) con un preview live del agent card,
para completar la publicación paso a paso sin sentirme abrumado y ver exactamente cómo quedará mi ficha antes de publicar.

---

## Criterios de Aceptación

- [ ] **AC1:** El formulario tiene 3 pasos con barra de progreso: **Básico** (nombre, descripción, categoría, avatar) → **Producto** (precio, modelo base, capabilities) → **Técnico** (endpoint URL, auth header, método HTTP)
- [ ] **AC2:** El creator puede navegar libremente entre pasos sin perder datos ya ingresados.
- [ ] **AC3:** Al pasar de paso a paso, se validan los campos requeridos del paso actual antes de avanzar.
- [ ] **AC4:** El preview live muestra el `AgentCard` exactamente como aparece en el marketplace: nombre, descripción, precio, categoría e imagen. Se actualiza en tiempo real. Precio muestra "— USDC/call" hasta que se defina en paso 2.
- [ ] **AC5:** Al pasar cada paso, el agente se guarda como `status='draft'` en DB. El creator puede cerrar el browser y retomar desde donde dejó.
- [ ] **AC6:** Al hacer click en "Publicar" en el paso final, el agente pasa a `status='active'` y aparece en el marketplace.
- [ ] **AC7:** Si el creator tiene un borrador previo sin publicar, al entrar a `/publish` ve ese borrador cargado con opción de continuar o descartar.

---

## Scope

**IN:**
- Nuevo formulario multi-paso en `/publish` (reemplaza el actual)
- Preview live del `AgentCard` (nombre, desc, precio, categoría, imagen)
- Auto-guardado como `status='draft'` al pasar de paso
- Carga de borrador previo al entrar a `/publish`
- Validación por paso antes de avanzar

**OUT:**
- Snippet de código en el preview (UX-04)
- Test de endpoint en tiempo real (HU-1.3)
- Editor estructurado de capabilities (UX-03) — mantener textarea JSON
- Múltiples borradores simultáneos — solo 1 borrador activo por creator
- Edición de agentes existentes ya publicados — roadmap (`/publish/[slug]/edit`)

---

## Notas del Analyst

- **Dependencias:** HU-1.1 redirige a este `/publish` — coordinar el redirect de éxito `?from=onboarding`.
- **Riesgo técnico:** El preview live requiere que `AgentCard` sea un componente aislado reutilizable. Si hoy no lo es, hay que extraerlo antes de implementar el preview.
- **Conflicto:** Capabilities mantiene textarea JSON (UX-03 lo convierte en editor estructurado — fuera de scope aquí).
- **Solo 1 borrador:** Si existe un draft previo al entrar a `/publish`, mostrar modal "Tienes un borrador sin publicar — ¿continuar o descartar?"

---

*Aprobada por Fer — 2026-02-25*
