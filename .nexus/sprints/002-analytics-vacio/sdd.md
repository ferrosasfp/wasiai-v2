# SDD #002: [BUG] Analytics completamente vacío (WAS-64)

> SPEC_APPROVED: no
> Fecha: 2026-02-27
> Tipo: bugfix
> SDD_MODE: bugfix
> Branch: fix/002-analytics-vacio
> Artefactos: doc/sdd/002-analytics-vacio/

---

## 1. Resumen del bug

El creator dashboard muestra sección de analytics completamente vacía: sin títulos, sin métricas numéricas, sin gráficos. El bug persiste después del hotfix previo (`force-dynamic` en la API route). La causa raíz es una combinación de dos problemas: (A) el namespace `analytics` de i18n probablemente ausente en los archivos de mensajes o no propagado al `NextIntlClientProvider` — lo que hace que `useTranslations('analytics')` devuelva strings vacíos para todos los textos del componente, incluyendo el `<h2>`, el estado de error y el empty state; (B) un estado de error silencioso cuando la API falla (el banner de error renderiza con texto vacío `t('errorLoading')`).

**Nota**: El API route (`route.ts`) fue leído en profundidad y su lógica es correcta. El problema está en el layer de presentación.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 002 |
| **Tipo** | bugfix |
| **Objetivo** | Identificar y corregir la causa raíz del analytics vacío — verificando el namespace i18n, el estado de error explícito, y el flujo de datos API → `CreatorAnalytics` → `CallsChart`. |
| **Scope IN** | `CreatorAnalytics.tsx`, archivos de mensajes i18n (`/messages/es.json`, `/messages/en.json`), y el layout/provider que pasa mensajes al cliente. Si la API falla: `route.ts` solo para diagnosticar la respuesta real. |
| **Scope OUT** | Rediseño visual del dashboard, nuevas métricas, cambios al modelo de datos `agent_calls`, `SummaryCards.tsx` (salvo que el diagnóstico lo requiera), `CallsChart.tsx` (lógica ya correcta). |

---

## 3. Repro steps

1. Autenticarse como creator
2. Navegar al creator dashboard (web desktop y mobile)
3. **Actual:** Sección de analytics completamente vacía — sin texto de título, sin tarjetas con números, sin gráfico. A veces ni el mensaje de error es visible.

---

## 4. Context Map (Codebase Grounding)

### Archivos leídos

| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/app/api/creator/analytics/route.ts` | API que provee los datos | Lógica correcta. `force-dynamic` ya aplicado. Retorna JSON bien formado con `summary`, `dailySeries`, `alerts`. Maneja el caso `agentIds.length === 0` con respuesta válida (zeros). Auth correcto con `createClient()`. |
| `src/features/creator/components/CreatorAnalytics.tsx` | Consumer del API — renderiza el dashboard | Usa `useTranslations('analytics')` → **sospechoso principal**. Estado inicializado como `{ status: 'loading', data: null }`. Fetch con `activeRef` para cleanup. Render condicional: loading/error/success. **Si `t('errorLoading')` es string vacío, el banner de error es invisible**. |
| `src/features/creator/components/analytics/CallsChart.tsx` | Gráfico de barras CSS (ADR-010) | Lógica correcta. Guard `allZero` muestra mensaje hardcoded (NO usa i18n). `maxCalls = Math.max(...series.map(d => d.calls), 1)` — no crashea con array vacío. El problema no está aquí. |

### Causa raíz — archivo:línea

#### Causa A (PRINCIPAL sospechada): Namespace i18n `analytics` ausente o no propagado

| Ubicación | Problema |
|-----------|---------|
| `src/features/creator/components/CreatorAnalytics.tsx:10` | `const t = useTranslations('analytics')` — si el namespace `'analytics'` no existe en `/messages/es.json` / `/messages/en.json`, o si el `NextIntlClientProvider` del layout no lo incluye, `t(key)` devuelve string vacío para TODOS los keys. |
| `CreatorAnalytics.tsx:~57` | `<h2>{t('title')}</h2>` → h2 visible pero con texto vacío → "sin título" |
| `CreatorAnalytics.tsx:~73` | `{t('errorLoading')}` → banner de error visible pero vacío → parece tarjeta vacía |
| `CreatorAnalytics.tsx:~85` | `{t('empty_state')}` → empty state invisible |

**Verificación obligatoria (primer paso del dev)**: Buscar en `/messages/es.json` y `/messages/en.json` el namespace `analytics`. Buscar en el layout creator el `NextIntlClientProvider` y verificar qué namespaces pasa.

#### Causa B (CONFIRMADA como contribuyente): Estado de error silencioso

| Ubicación | Problema |
|-----------|---------|
| `src/features/creator/components/CreatorAnalytics.tsx:~47` | El catch del fetch llama `setState({ status: 'error', data: null })`. Esto renderiza el banner de error con `t('errorLoading')`. Si las traducciones están vacías (Causa A), el banner es una caja roja vacía — prácticamente invisible. El usuario ve "tarjetas vacías". |

#### Causa C (SECUNDARIA, posible): `SummaryCards` o `CallsChart` no reciben datos

| Ubicación | Problema |
|-----------|---------|
| `src/features/creator/components/CreatorAnalytics.tsx:~78` | `{state.status === 'success' && state.data && (<SummaryCards summary={state.data.summary} />)}` — si el API retorna 200 pero `state.data.summary` es `undefined` (e.g. shape mismatch), `SummaryCards` crashearía silenciosamente sin error boundary. **Verificar con console.log/devtools si el API retorna 200.** |

### Exemplar para el fix

| Fix en | Seguir patrón de | Razón |
|--------|-----------------|-------|
| Agregar claves i18n `analytics.*` | Examinar namespace `nav` en `/messages/es.json` como referencia de estructura | Consistencia de formato de mensajes |
| Estado de error con texto visible | Patrón existente en `CreatorAnalytics.tsx:70-73` — ya tiene el banner, solo necesita el texto correcto | No crear nuevo patrón |

---

## 5. Plan de diagnóstico y fix

### Paso 1 (DIAGNÓSTICO — sin cambios): Verificar i18n

```bash
# Verificar si existe el namespace analytics en los mensajes
grep -n '"analytics"' messages/es.json messages/en.json
```

- **Si NO existe**: agregar el namespace con todas las claves usadas en `CreatorAnalytics.tsx`.
- **Si existe**: verificar que el `NextIntlClientProvider` del layout creator lo incluye.

### Paso 2 (DIAGNÓSTICO): Verificar respuesta real del API

Abrir DevTools → Network → navegar al creator dashboard → verificar:
- `GET /api/creator/analytics` retorna 200 con payload bien formado
- Si retorna 404/401/500: identificar la falla en el route

### Fix A — Agregar claves i18n faltantes (si Diagnóstico confirma Causa A)

**Archivo**: `/messages/es.json` y `/messages/en.json`

Claves requeridas por `CreatorAnalytics.tsx`:

| Key | Valor ES | Valor EN |
|-----|----------|----------|
| `analytics.title` | `"Analytics"` | `"Analytics"` |
| `analytics.all_agents` | `"Todos los agentes"` | `"All agents"` |
| `analytics.errorLoading` | `"Error al cargar analytics. Intenta de nuevo."` | `"Failed to load analytics. Please try again."` |
| `analytics.empty_state` | `"Sin actividad aún. Comparte tu agente para empezar."` | `"No activity yet. Share your agent to get started."` |

### Fix B — Garantizar visibilidad del estado de error (siempre aplicar)

**Archivo**: `src/features/creator/components/CreatorAnalytics.tsx`

El estado de error debe ser visible incluso si `t('errorLoading')` falla. Agregar texto fallback:

```tsx
// ANTES:
{t('errorLoading')}

// DESPUÉS:
{t('errorLoading') || 'Error al cargar analytics. Intenta de nuevo.'}
```

### Fix C — Agregar error boundary o guard de datos (si diagnóstico confirma shape mismatch)

Si el API retorna data con shape inesperada, agregar un guard antes de renderizar `SummaryCards`:

```tsx
// ANTES:
{state.status === 'success' && state.data && (
  <SummaryCards summary={state.data.summary} />
)}

// DESPUÉS:
{state.status === 'success' && state.data?.summary && (
  <SummaryCards summary={state.data.summary} />
)}
```

**Archivos a tocar** (dependiendo del diagnóstico):

| Archivo | Acción | Condición |
|---------|--------|-----------|
| `/messages/es.json` | Agregar namespace `analytics` con claves | Si Causa A confirmada |
| `/messages/en.json` | Idem en inglés | Si Causa A confirmada |
| `src/features/creator/components/CreatorAnalytics.tsx` | Fix B fallback error + Fix C guard | Siempre (Fix B) / Si shape mismatch (Fix C) |

---

## 6. Acceptance Criteria (EARS)

1. **WHEN** un creator autenticado abre su dashboard, **THE** sección de analytics **SHALL** mostrar al menos el título "Analytics" y los valores numéricos de total calls, revenue total y agentes activos — aunque sean cero.

2. **WHEN** el endpoint `/api/creator/analytics` retorna datos válidos, **THE** componente `CreatorAnalytics` **SHALL** propagar esos datos a `SummaryCards` y `CallsChart`, y este último **SHALL** renderizar barras CSS o el mensaje "Sin llamadas todavía".

3. **IF** `/api/creator/analytics` retorna un error HTTP (4xx/5xx), **THEN THE** dashboard **SHALL** mostrar un banner de error con texto legible al usuario — nunca una caja vacía o en blanco.

4. **WHILE** los datos de analytics están cargando, **THE** tarjetas **SHALL** mostrar 5 skeleton loaders visibles (`animate-pulse`), no contenido en blanco.

5. **WHEN** el creator no tiene ninguna llamada registrada, **THE** sección de analytics **SHALL** mostrar ceros con el mensaje "Sin actividad aún" visible — nunca tarjetas completamente vacías sin texto.

---

## 7. Constraint Directives (Anti-Alucinación)

### OBLIGATORIO seguir
- Claves i18n: seguir la estructura del namespace existente más cercano (e.g. `nav`, `auth`) en `/messages/es.json`
- No inventar claves que no estén referenciadas en `CreatorAnalytics.tsx`
- Pattern de fallback: `t('key') || 'texto fallback'` — no crear nuevo mecanismo

### PROHIBIDO
- NO refactorizar `CreatorAnalytics.tsx` más allá del fix mínimo
- NO tocar `CallsChart.tsx` — su lógica es correcta
- NO tocar `SummaryCards.tsx` salvo que el diagnóstico lo requiera explícitamente
- NO modificar la lógica de fetch o el polling interval
- NO agregar dependencias nuevas (next-intl ya está instalado)
- NO cambiar el esquema de la API response en `route.ts`
- NO agregar recharts u otras librerías de gráficos — ADR-010 dice CSS bars

---

## 8. Implementation Readiness Check

```
READINESS CHECK:
[x] Cada AC tiene al menos 1 archivo/acción asociada
[x] Archivos con fix tienen Exemplar válido (patrón existente en mismo archivo)
[ ] Causa raíz A (i18n) requiere verificación con grep antes de implementar — marcado [TBD]
[x] Causa B (error silencioso) es confirmada y el fix es mínimo (1 línea)
[x] Causa C (guard) es opcional/condicional — no bloqueante
[x] Constraint Directives incluyen más de 3 PROHIBIDO (6 listados)
[x] Context Map tiene 3 archivos leídos
[x] Scope IN y OUT son explícitos
[x] Sin cambios de BD
```

**[TBD]**: Confirmar si `/messages/es.json` tiene el namespace `analytics` antes de escribir claves. Si existe, el fix es diferente (verificar provider). Si no existe, agregar keys listadas en el Fix A.

---

## 9. DoD (Definition of Done)

- [ ] `grep '"analytics"' messages/es.json messages/en.json` ejecutado y resultado documentado
- [ ] Causa raíz identificada (A, B, C o combinación) con evidencia de DevTools/logs
- [ ] Claves i18n del namespace `analytics` presentes y correctas en ES y EN (si aplicaba)
- [ ] En creator dashboard autenticado: título "Analytics" visible y legible
- [ ] En creator dashboard autenticado: tarjetas de summary muestran números (aunque sean ceros)
- [ ] En creator dashboard autenticado: `CallsChart` renderiza barras o mensaje "Sin llamadas"
- [ ] Estado de error muestra texto explícito, nunca caja vacía
- [ ] TypeScript: sin errores (`npm run type-check` pasa)
- [ ] Sin regresiones en mobile (verificar viewport móvil)
- [ ] AC1–AC5 verificados manualmente

---

## 10. Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| El namespace `analytics` existe pero el provider no lo incluye (requiere cambio en layout) | Media | Buscar `NextIntlClientProvider` en `src/app/[locale]/creator/layout.tsx` o similar |
| La API retorna 404 por creator_profile no creado en seed de dev | Media | Verificar en DevTools; si es el caso, seed el perfil o manejar el 404 en el componente |
| Shape mismatch entre lo que devuelve la API y lo que espera `SummaryCards` | Baja — API tiene tipos TypeScript | Revisar si hay cambio reciente en el tipo `AnalyticsSummary` |
| Hotfix previo (`force-dynamic`) no era la causa real — el bug persiste | Alta (ya confirmado) | `force-dynamic` ya está aplicado; buscar la causa real en i18n |

---

*SDD generado por NexusAgil — Architect — Sprint 9 — BUGFIX*
