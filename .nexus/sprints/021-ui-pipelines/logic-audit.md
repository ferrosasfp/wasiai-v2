# Adversarial Review — WAS-38: UI Visual de Pipelines

**Fecha:** 2026-03-02  
**Adversary:** San (subagente NexusAgil)  
**Archivos revisados:**
- `src/components/pipelines/PipelineBuilder.tsx`
- `src/components/pipelines/PipelineStatus.tsx`
- `src/components/pipelines/PipelineHistory.tsx`
- `src/components/pipelines/index.ts`
- `src/app/[locale]/pipelines/page.tsx`
- `src/app/[locale]/pipelines/_components/PipelinePageClient.tsx`

---

## 🔴 BLOQUEANTES (2)

---

### B-01 — API Key en `localStorage` sin protección adicional

**Archivo:** `PipelineBuilder.tsx:45–48`  
**Severidad:** BLOQUEANTE — credencial financiera expuesta  

**Descripción:**  
La API key del usuario se persiste en `localStorage` con clave `wasi_pipeline_api_key`. `localStorage` es accesible por cualquier script JS en el mismo origen. Si el sitio tiene una vulnerabilidad XSS (en cualquier parte, no solo en pipelines), un atacante puede extraer la API key y usarla para ejecutar pipelines a costo del usuario (pagos reales en USDC).

```ts
// PipelineBuilder.tsx:45
localStorage.setItem(API_KEY_STORAGE_KEY, value)
```

**Riesgo concreto:** La API key autoriza llamadas a `/api/v1/compose` que consumen USDC del usuario. Una key robada = pérdida económica directa.

**Corrección requerida:**  
Opciones ordenadas por seguridad:
1. **No persistir** — Solo en estado de React (se pierde al recargar, pero es la más segura). Con un tooltip/hint de que el usuario puede guardarla en su gestor de contraseñas.
2. **`sessionStorage`** — Solo vive en la pestaña activa. Reduce la ventana de ataque.
3. Si se mantiene `localStorage`: documentar explícitamente el riesgo en la UI y agregar un warning visible.

> `sessionStorage` es el mínimo aceptable para producción con credenciales financieras.

---

### B-02 — `PipelineHistory` sin filtro `.eq('user_id', userId)` — dependencia frágil de RLS

**Archivo:** `PipelineHistory.tsx:56–63`  
**Severidad:** BLOQUEANTE — data leak potencial  

**Descripción:**  
La query a Supabase no incluye filtro explícito por usuario:

```ts
supabase
  .from('pipeline_executions')
  .select('id, status, steps_completed, total_cost_usdc, created_at, completed_at')
  .order('created_at', { ascending: false })
  .limit(20)
  // ❌ Falta: .eq('user_id', userId)
```

El componente recibe `userId` como prop pero lo usa **solo** como guard de renderizado (`if (!userId) return`). El filtrado real depende 100% de que RLS esté configurado correctamente en Supabase.

**Riesgo:** Si RLS no está activo, está mal configurado, o se usa el service client en algún contexto futuro, el historial devuelve las 20 ejecuciones más recientes de **todos los usuarios** — incluyendo costos y pipeline IDs ajenos.

**Corrección requerida:**  
Agregar el filtro explícito como defensa en profundidad:

```ts
supabase
  .from('pipeline_executions')
  .select('id, status, steps_completed, total_cost_usdc, created_at, completed_at')
  .eq('user_id', userId)   // ← AGREGAR
  .order('created_at', { ascending: false })
  .limit(20)
```

RLS sigue siendo necesario, pero el filtro en código es la segunda capa de seguridad.

---

## 🟡 MENORES (4)

---

### M-01 — `failed_step` no se renderiza en el estado de error

**Archivo:** `PipelinePageClient.tsx:101`, `PipelineStatus.tsx:73–85`  

La respuesta de error de la API incluye `failed_step: number`, pero no se almacena en `runState` ni se muestra al usuario. El usuario ve "Steps completados antes del error: N" pero no sabe en qué step puntual falló.

**Corrección sugerida:** Agregar `failedStep?: number` a `PipelineRunState` y mostrarlo en el bloque `failed` de `PipelineStatus`:
```tsx
{runState.failedStep != null && (
  <p className="text-xs text-red-500">
    Falló en el step {runState.failedStep + 1}
  </p>
)}
```

---

### M-02 — Tabla en `PipelineHistory` sin `overflow-x-auto` (mobile)

**Archivo:** `PipelineHistory.tsx:85`  

El contenedor de la tabla tiene `overflow-hidden` pero no `overflow-x-auto`. En pantallas pequeñas (< 400px), la tabla se recorta sin scroll horizontal.

**Corrección sugerida:**
```tsx
<div className="border rounded-lg overflow-x-auto">
```

---

### M-03 — `key={index}` en lista de steps

**Archivo:** `PipelineBuilder.tsx:93`  

Se usa el índice como key al renderizar steps. Cuando se elimina un step intermedio, React reutiliza el DOM incorrecto, causando glitches visuales en los inputs.

**Corrección sugerida:** Usar un ID estable generado al crear el step:
```ts
{ id: crypto.randomUUID(), agent_slug: ..., input: '', ... }
```
Y usar `key={step.id}`.

---

### M-04 — Fragmento sin `key` en `tbody` de `PipelineHistory`

**Archivo:** `PipelineHistory.tsx:101`  

El `.map()` sobre `items` usa `<>...</>` (fragmento corto) que no acepta `key`. Genera warnings de React en consola.

**Corrección sugerida:** Reemplazar `<>` por `<React.Fragment key={item.id}>`.

---

## ✅ Sin hallazgos críticos

| Check | Resultado |
|-------|-----------|
| API key no logueada en consola | ✅ OK |
| `receipt_signature` no expuesto en DOM | ✅ OK (comentado y excluido del render) |
| Double-submit del botón Ejecutar | ✅ OK — `disabled={!canRun}` bloquea durante `isRunning` |
| Error claro si no hay API key | ✅ OK — warning amber + botón deshabilitado |
| No hay `any` explícito | ✅ OK — se usa `unknown` correctamente |
| Estados loading/error en todos los componentes | ✅ OK |
| XSS en resultado de compose | ✅ OK — `JSON.stringify` dentro de `<pre>`, React escapa |
| `input` del usuario no interpolado en HTML peligroso | ✅ OK — va como JSON body |

---

## Resumen

> **AR DONE WAS-38 — 2 BLOQUEANTES, 4 MENORES**

Los dos bloqueantes deben corregirse antes de merge a `main`. El más urgente es **B-02** (data leak de historial) porque puede estar activo en producción si RLS no está 100% probado. **B-01** es crítico por riesgo económico directo al usuario.
