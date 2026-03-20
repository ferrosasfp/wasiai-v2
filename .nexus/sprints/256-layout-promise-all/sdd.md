# SDD #256: Layout — Paralelizar awaits en root layout

> SPEC_APPROVED: no
> Fecha: 2026-03-20
> Tipo: improvement
> SDD_MODE: mini
> Branch: improvement/256-layout-promise-all
> Artefactos: .nexus/sprints/256-layout-promise-all/

---

## 1. Resumen

El root layout ejecuta `getMessages()` y `createClient()` secuencialmente. Ambas son independientes. Paralelizarlas con `Promise.all` reduce el tiempo de cada page render al máximo de las dos en lugar de la suma. Afecta el 100% de las páginas del app en cada request.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 256 |
| **Tipo** | improvement |
| **SDD_MODE** | mini |
| **Objetivo** | Paralelizar getMessages() y createClient() en root layout |
| **Scope IN** | `src/app/[locale]/layout.tsx` — lines 29-34 only |
| **Scope OUT** | Todo lo demás. No otros archivos. No DB. No auth. |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

- **AC1:** WHEN the root layout renders, THE system SHALL execute `getMessages()` and `createClient()` in parallel via `Promise.all`.
- **AC2:** WHEN the parallel calls complete, THE destructured result SHALL maintain order `[messages, supabase]` matching the input array order.
- **AC3:** WHEN parallel calls complete, `messages` SHALL be passed to `NextIntlClientProvider` AND `user` SHALL be passed to `WasiNavBar` and `BottomTabBar` as `initialEmail`.
- **AC4:** IF either `getMessages()` or `createClient()` throws, THE error SHALL propagate to the nearest Next.js error boundary without being swallowed.
- **AC5:** WHEN the change is applied, THE TypeScript build (`tsc --noEmit`) SHALL pass with zero errors.

---

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/[locale]/layout.tsx` | Archivo objetivo | Sequential awaits en líneas 29-34; `supabase` se usa en línea 35 para `auth.getUser()` |

### Estado actual del código

```ts
// líneas 29-34 actuales
const messages = await getMessages()
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
```

### Componentes reutilizables

N/A — cambio de 1 expresión.

---

## 4. Diseño Técnico

### 4.1 Archivos a modificar

| Archivo | Acción | Qué cambia | Exemplar |
|---------|--------|-----------|----------|
| `src/app/[locale]/layout.tsx` | Modificar | Lines 29-34: envolver en Promise.all | Patrón estándar de Promise.all con desestructuración |

### 4.2 Cambio exacto

**Antes:**
```ts
const messages = await getMessages()
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
```

**Después:**
```ts
const [messages, supabase] = await Promise.all([
  getMessages(),
  createClient(),
])
const { data: { user } } = await supabase.auth.getUser()
```

### 4.3 Flujo principal

1. Root layout inicia render
2. `Promise.all([getMessages(), createClient()])` se ejecuta — ambas en paralelo
3. Cuando ambas resuelven, se desestructuran en `[messages, supabase]`
4. `supabase.auth.getUser()` se ejecuta con el cliente resuelto
5. Layout renderiza con `messages` y `user` disponibles — igual que antes

### 4.4 Flujo de error

- Si `getMessages()` lanza → `Promise.all` rechaza → error propaga al error boundary de Next.js (igual que antes)
- Si `createClient()` lanza → idem

---

## 5. Waves de Implementación

### Wave 0 — Pre-flight
- [ ] W0.1: Verificar que `src/app/[locale]/layout.tsx` existe y tiene la estructura esperada
- [ ] W0.2: `tsc --noEmit` en el estado actual pasa sin errores

### Wave 1 — Implementación
- [ ] W1.1: Modificar líneas 29-34 en `layout.tsx` con el cambio exacto descrito en 4.2
- [ ] W1.2: Build gate: `tsc --noEmit` debe pasar

### Wave 2 — Verificación
- [ ] W2.1: Build gate final: `npm run build` o `tsc --noEmit` pasa sin errores
- [ ] W2.2: Confirmar que `messages` llega a `NextIntlClientProvider` y `user` llega a `WasiNavBar` y `BottomTabBar`

---

## 6. Constraint Directives

### OBLIGATORIO
- Orden del array en `Promise.all`: `[getMessages(), createClient()]` — `messages` primero, `supabase` segundo
- La línea de `supabase.auth.getUser()` va DESPUÉS del `Promise.all`, no dentro

### PROHIBIDO
- NO modificar ningún otro archivo
- NO cambiar la estructura del JSX retornado
- NO cambiar los props que reciben `WasiNavBar`, `BottomTabBar`, o `NextIntlClientProvider`
- NO agregar manejo de errores extra — el comportamiento de error debe ser idéntico al actual

---

## 7. Rollback

`git revert <commit>` — una sola expresión cambiada, sin efectos colaterales.

---

## 8. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| TypeScript no acepta el tipo de `supabase` desestructurado | Baja | Bajo | `tsc --noEmit` en Wave 0 lo detectaría antes |
| Algún middleware lee estado entre getMessages y createClient | Ninguna | — | Son funciones independientes, sin estado compartido |

---

*SDD generado por NexusAgil — MINI*
