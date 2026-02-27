# S0 — HU-4.1: Búsqueda semántica en el catálogo de agentes

**Estado:** DRAFT · **Autor:** PM San · **Fecha:** 2026-02-27  
**Epic:** EP-4 — Marketplace Discovery  
**Gate:** Pendiente HU_APPROVED de Fer

---

## 1. Descripción del problema

El marketplace de WasiAI hoy solo permite filtrar por categoría. Con el catálogo creciendo a 10+ agentes reales, un Consumer que no conoce el nombre exacto del agente que necesita no tiene forma de encontrarlo. La ausencia de búsqueda de texto mata el descubrimiento y la conversión.

**Evidencia del problema:**
- UI actual: un dropdown de categorías, nada más
- Si el usuario busca "agente que analice contratos de Solidity", no hay forma de llegar a él
- El catálogo completo es la única vista alternativa — no escala

---

## 2. Objetivo de la HU

Permitir al Consumer encontrar agentes relevantes mediante búsqueda por texto libre, cubriendo name, description y tags, con resultados rankeados por relevancia.

---

## 3. User Stories

### US-4.1.1 — Búsqueda básica (Consumer)
> Como Consumer, quiero escribir palabras clave en una barra de búsqueda y ver agentes relevantes, para encontrar rápidamente el agente que resuelve mi problema sin tener que navegar el catálogo completo.

### US-4.1.2 — Búsqueda combinada con filtro (Consumer)
> Como Consumer, quiero combinar búsqueda por texto con el filtro de categoría existente, para refinar resultados cuando sé la categoría pero busco una función específica.

### US-4.1.3 — Resultado vacío informativo (Consumer)
> Como Consumer, cuando mi búsqueda no devuelve resultados, quiero ver un mensaje claro con sugerencias (ej. revisar ortografía, ampliar términos), para no quedarme con una pantalla vacía sin entender qué pasó.

### US-4.1.4 — Búsqueda como agente autónomo (Agente autónomo)
> Como agente autónomo que necesita delegar una tarea, quiero consultar el catálogo vía API con un query de texto, para elegir el agente correcto sin intervención humana.

---

## 4. Criterios de Aceptación (ACs)

### AC-1: Barra de búsqueda visible en el marketplace
- [ ] Existe un input de búsqueda en la página `/marketplace` (o equivalente)
- [ ] El input tiene placeholder descriptivo (ej. "Busca agentes por función, tecnología...")
- [ ] El input es accesible (label o aria-label presente)

### AC-2: Búsqueda funcional contra PostgreSQL full-text search
- [ ] La búsqueda consulta campos `name`, `description` y `tags` del catálogo de agentes
- [ ] Se usa `tsvector/tsquery` de PostgreSQL (función nativa Supabase, sin costo adicional)
- [ ] La búsqueda es case-insensitive
- [ ] Los resultados están rankeados por relevancia (`ts_rank`)
- [ ] El query mínimo aceptado es 2 caracteres (menos de 2 no lanza búsqueda)

### AC-3: Debounce en el frontend
- [ ] La búsqueda se dispara con debounce de ≥300ms después de que el usuario deja de escribir
- [ ] No se realiza ningún fetch por cada keystroke individual

### AC-4: Compatibilidad con filtro de categoría
- [ ] Se puede aplicar búsqueda + filtro de categoría simultáneamente
- [ ] Limpiar la búsqueda restaura el catálogo al estado filtrado por categoría activa (si hay una)

### AC-5: Estado vacío
- [ ] Si no hay resultados, se muestra un componente de empty state con mensaje claro
- [ ] No se muestra ningún spinner infinito ni pantalla en blanco

### AC-6: Performance
- [ ] La búsqueda responde en ≤500ms en condiciones normales (Supabase Fuji)
- [ ] Existe índice `GIN` sobre la columna `search_vector` en la tabla de agentes

### AC-7: API endpoint para agentes autónomos
- [ ] Existe endpoint `GET /api/agents?q=<query>` (o equivalente REST/RPC)
- [ ] El endpoint acepta parámetro `q` y devuelve resultados rankeados en JSON
- [ ] El endpoint tiene rate limiting vía Upstash Redis
- [ ] El endpoint no expone datos sensibles (solo campos públicos del agente)

### AC-8: Sin regresiones
- [ ] El filtro de categoría existente sigue funcionando sin cambios de comportamiento
- [ ] Los tests e2e del marketplace pasan en verde

---

## 5. Scope — MVP con tsvector

### ✅ Incluido en este MVP

| Item | Justificación |
|------|---------------|
| PostgreSQL `tsvector/tsquery` | Nativo en Supabase, sin costo, soporta español e inglés |
| Índice GIN en `search_vector` | Esencial para performance a escala |
| Ranking por `ts_rank` | Resultados más útiles sin complejidad de ML |
| Campos indexados: `name`, `description`, `tags` | Cubre los casos de uso reales del Consumer |
| Debounce en UI | Protege cuota de Supabase |
| Endpoint API para agentes autónomos | Caso de uso core de WasiAI |
| Rate limiting en el endpoint | Regla absoluta del proyecto |

### ❌ Excluido de este MVP (roadmap)

| Item | Motivo de exclusión |
|------|---------------------|
| pgvector / embeddings semánticos | Requiere modelo de embeddings (costo), infraestructura adicional; no es necesario para MVP |
| Búsqueda multiidioma avanzada (stemming por idioma) | Complejidad innecesaria en esta etapa |
| Autocompletado / sugerencias en tiempo real | Requiere índice adicional y UX más compleja |
| Búsqueda por reputación on-chain o métricas de uso | Datos aún escasos; roadmap EP-5 |
| Filtros avanzados (precio, rating, invocaciones) | HU separada |

### Decisión técnica: ¿Por qué tsvector y no pgvector?

`pgvector` ofrece búsqueda semántica real (entiende sinónimos, contexto), pero requiere:
1. Modelo de embeddings (OpenAI, Cohere, etc.) → costo por llamada
2. Pipeline de generación de embeddings al publicar agentes
3. Más superficie de fallo y latencia

`tsvector` en Supabase:
- Nativo, sin dependencias externas
- Índice GIN → búsqueda O(log n) en millones de filas
- Soporta operadores booleanos (`&`, `|`, `!`) y prefijos (`agent:*`)
- Suficiente para un catálogo de 10-500 agentes

**Decisión: tsvector como MVP. Migrar a pgvector si el catálogo supera 500 agentes y los usuarios reportan resultados irrelevantes.**

---

## 6. Definición de Done (DoD)

- [ ] Código en PR revisado y aprobado (Code Review formal)
- [ ] Adversarial Review pasada (ningún vector de SSRF, inyección SQL, rate limit bypass)
- [ ] Índice GIN creado vía migration numerada (`017_search_vector_agents.sql`)
- [ ] RLS activo — endpoint solo devuelve agentes con status `active` o `published`
- [ ] Tests unitarios del helper de búsqueda
- [ ] Test e2e: buscar → ver resultados → limpiar → ver catálogo completo
- [ ] Documentación del endpoint en OpenAPI/README
- [ ] Deploy en Vercel sin degradación de performance en Lighthouse

---

## 7. Riesgos

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|----|--------|-------------|---------|------------|
| R1 | `tsvector` no rankea bien en búsquedas cortas (1-2 palabras) | Media | Medio | Ajustar weights: `A`=name, `B`=tags, `C`=description; testear con queries reales |
| R2 | Índice GIN no existe → búsqueda lenta con catálogo grande | Alta (si no se crea) | Alto | AC-6 y migration obligatoria como parte del DoD |
| R3 | El endpoint de búsqueda no tiene rate limit → abuso | Alta (sin mitigación) | Alto | Upstash Redis en el handler, regla absoluta del proyecto |
| R4 | La búsqueda devuelve agentes inactivos o en draft | Media | Medio | RLS + filtro `status = 'active'` explícito en el query |
| R5 | El debounce no se implementa → quema cuota de Supabase | Media | Medio | AC-3 verificado en Code Review |
| R6 | El Consumer busca en español y los agentes están en inglés (o viceversa) | Media | Medio | Configurar `to_tsvector('simple', ...)` para ser idioma-agnóstico en MVP; evaluar `spanish`/`english` config en v2 |

---

## 8. Preguntas abiertas (para resolver antes de S1)

1. ¿El campo `tags` ya existe en la tabla de agentes? Si no, ¿se agrega en esta HU o en una separada?
2. ¿La búsqueda aplica a agentes de todos los Creators o solo a los del Consumer autenticado?
3. ¿Se incluye búsqueda en la landing pública (`/`) o solo en el marketplace autenticado?
4. ¿El endpoint `/api/agents?q=` es público (sin auth) o requiere API key?

---

## 9. Referencias

- Stack: `project-context.md` — PostgreSQL + Supabase + Next.js 14
- Migration siguiente disponible: `017_*.sql`
- Rate limiting: Upstash Redis (configurado en TOOLS.md)
- Epic relacionado: EP-4 — Marketplace Discovery

---

*Generado por agente PM San — BMAD Method v6 — 2026-02-27*  
*Pendiente: HU_APPROVED explícito de Fer para avanzar a S1*
