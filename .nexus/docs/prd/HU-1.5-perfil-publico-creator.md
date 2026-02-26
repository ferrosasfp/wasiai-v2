# HU-1.5 — Perfil Público del Creator

> **Estado:** HU_APPROVED ✅
> **Linear:** WAS-9
> **Sprint:** 2 (25 Feb – 28 Feb 2026)
> **Épica:** 1 — Creators Reales

---

## Historia de Usuario

Como **usuario del marketplace** que encontró un agente interesante,
quiero ver la página pública del creator que lo publicó con todos sus agentes,
para descubrir más agentes del mismo autor y decidir si confío en él.

Como **creator**,
quiero tener una página pública que muestre quién soy y qué agentes ofrezco,
para tener identidad en el marketplace y que los usuarios me descubran orgánicamente.

---

## Criterios de Aceptación

- [ ] **AC1:** Existe una ruta `/[locale]/creator/[username]` pública (sin auth) que muestra:
  - Avatar (inicial del email si no hay foto)
  - Nombre / username del creator
  - Bio corta (si está configurada en el perfil)
  - Total de agentes publicados (status = 'active')
  - Total de llamadas recibidas (suma de todas sus llamadas)
  - Fecha de "miembro desde" (created_at del perfil)

- [ ] **AC2:** La página lista todos los agentes activos del creator como cards clicables que llevan a la ficha del agente.
  - Las cards son las mismas que en el marketplace (consistencia visual)
  - Si el creator no tiene agentes activos, se muestra: "Este creator aún no ha publicado agentes."

- [ ] **AC3:** Desde la ficha de cada agente (`/[locale]/agents/[slug]`), el nombre del creator es un link que lleva a su perfil público.

- [ ] **AC4:** El username se deriva del email por defecto (parte antes del @). Si dos creators tienen el mismo prefijo, se añade un sufijo numérico. El creator puede cambiarlo desde settings (fuera del scope de esta HU — en esta HU es solo lectura / auto-generado).

- [ ] **AC5:** La página es estatica con ISR de 10 min (`revalidate = 600`). No hay estado cliente.

- [ ] **AC6:** SEO básico: `<title>` y `<meta description>` con nombre del creator y número de agentes.

- [ ] **AC7:** Manejo de errores: si el `username` no existe → 404 claro con CTA al marketplace.

---

## Scope

### In scope
- Ruta pública `/creator/[username]`
- Lista de agentes activos del creator
- Stats básicos (agentes, calls totales, miembro desde)
- Link desde ficha del agente al perfil del creator
- ISR + SEO básico
- Auto-generación de username desde email

### Out of scope
- Edición del perfil / bio desde esta página
- Foto de perfil (solo inicial del email)
- Seguir a un creator / sistema de follows
- Ordenar agentes (por popularidad, precio, etc.)
- Agentes en draft visibles (solo status = 'active')
- Username custom editable (roadmap)

---

## Diseño / UX

- Header del perfil: avatar circular (inicial), nombre, bio, stats en pills
- Grid de agent cards igual al marketplace
- Mobile first — debe verse bien en el celular
- Paleta Avalanche red consistente con el resto del site

---

## Datos en DB

- `creator_profiles`: `id`, `user_id`, `wallet_address`, `bio` (puede ser null), `created_at`
- `agents`: `slug`, `name`, `description`, `price_usdc`, `category`, `status`, `creator_id`
- `agent_calls`: count por `agent_id` para total de llamadas del creator
- Auth user: `email` → para derivar username y avatar

---

## Notas técnicas

- El `username` se calcula al vuelo: `email.split('@')[0]` normalizado (lowercase, sin puntos/+). Si hay colisiones en el futuro, añadir sufijo numérico. Por ahora no hay colisiones en el MVP.
- La ruta busca el creator por `username` derivado. Para evitar N+1, una query JOIN: `creator_profiles JOIN auth.users JOIN agents`.
- No exponer el `email` completo ni el `wallet_address` en la respuesta pública.
- Considerar agregar columna `username` a `creator_profiles` en migration 016 para evitar calcular al vuelo en cada request.
