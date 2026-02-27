# Adversarial Review — Sprint 8 (commit 85887f3)
**Fecha:** 2026-02-27  
**Revisor:** Agente AR (BMAD Method v6)  
**Scope:** HU-4.3 (AgentExamples CRUD), HU-4.4 (Reputation), HU-MOBILE-NAV  
**Veredicto general:** ⚠️ CONDICIONAL — 1 BLOQUEANTE, 4 MENORES

---

## BLOQUEANTES

### 🔐 B-01 — Race condition en límite de 5 ejemplos por agente

**Archivo:** `src/app/api/creator/agents/[id]/examples/route.ts` — POST handler  
**Severidad:** BLOQUEANTE  

**Problema:**  
El check del límite de MAX_EXAMPLES (5) se realiza con un `SELECT COUNT` separado antes del `INSERT`. No es atómico:

```ts
// PASO 1 — lee count
const { count } = await supabase
  .from('agent_examples')
  .select('id', { count: 'exact', head: true })
  .eq('agent_id', agentId)

if ((count ?? 0) >= MAX_EXAMPLES) { ... }  // si count = 4, pasa

// PASO 2 — inserta (otro request concurrent también pasó el check)
await supabase.from('agent_examples').insert(...)
```

Con 2+ requests concurrentes (doble-click, peticiones paralelas), ambas leen `count = 4`, ambas pasan el check, y se insertan 2 filas simultáneamente → el agente termina con 6+ ejemplos. No hay ningún constraint en la DB (`021_agent_examples.sql`) que limite el máximo por agente.

**Fix requerido (dos opciones — cualquiera sirve):**

**Opción A** — Constraint a nivel DB (preferido):
```sql
-- Añadir en migración o nueva migración 022
CREATE UNIQUE INDEX idx_agent_examples_max
  ON agent_examples (agent_id, sort_order);
-- O más directo: trigger/check que limite a 5
```

**Opción B** — INSERT condicional con subquery (evita el round-trip):
```sql
-- Vía RPC o supabase.rpc:
INSERT INTO agent_examples (agent_id, creator_id, input, output, label)
SELECT $1, $2, $3, $4, $5
WHERE (SELECT COUNT(*) FROM agent_examples WHERE agent_id = $1) < 5
RETURNING *;
```
Si el INSERT no retorna filas (count >= 5), devolver 422.

---

## MENORES

### ⚡ M-01 — RLS `FOR ALL` sin `WITH CHECK` explícito

**Archivo:** `supabase/migrations/021_agent_examples.sql`  
**Severidad:** MENOR

**Problema:**  
```sql
CREATE POLICY "agent_examples_creator_write"
  ON agent_examples FOR ALL
  USING (creator_id = auth.uid());
  -- ← Sin WITH CHECK explícito
```

Postgres documenta que cuando `FOR ALL` (o INSERT/UPDATE) no tiene `WITH CHECK`, reutiliza la expresión `USING`. Funciona correctamente **en la implementación actual**, pero es una trampa para el futuro: si alguien agrega `WITH CHECK (true)` creyendo que amplía la política, en realidad bypasearía el ownership check en INSERT.

**Fix recomendado:**
```sql
CREATE POLICY "agent_examples_creator_write"
  ON agent_examples FOR ALL
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());  -- explícito, sin ambigüedad
```

---

### 🔑 M-02 — `AgentExamplesDisplay` usa Service Role Client para datos públicos

**Archivo:** `src/features/models/components/AgentExamplesDisplay.tsx`  
**Severidad:** MENOR

**Problema:**  
```ts
const supabase = createServiceClient()  // ← Service Role = bypass RLS completo
```

El componente lee datos que son public por política RLS (`agent_examples_public_read`). No necesita service role. Si en el futuro se cambia la política pública y se agrega un filtro de visibilidad (e.g., `is_published = true`), este componente los ignoraría silenciosamente.

**Fix recomendado:** Usar cliente anon o el `createClient()` SSR estándar (sin auth) para reads públicos.

---

### 🧹 M-03 — Dead code en WasiNavBar aumenta bundle y genera confusión

**Archivo:** `src/components/WasiNavBar.tsx`  
**Severidad:** MENOR

**Problema:**  
El componente mantiene:
1. `const [menuOpen, setMenuOpen] = useState(false)` — estado que nunca cambia efectivamente
2. Botón hamburger con `className="hidden"` — inaccessible pero presente en DOM
3. Mobile menu completo wrapped en `{false && menuOpen && (...)}` — código muerto en el bundle

El `false &&` garantiza que nunca renderiza, pero el código se parsea, transpila y empaqueta igual.

**Fix recomendado:** Eliminar `menuOpen` state, el botón hamburger, y todo el bloque `{false && menuOpen && ...}`. El mobile nav ya fue reemplazado por `MobileBottomNav`.

---

### 🧹 M-04 — `fetchExamples` callback duplicado con lógica en `useEffect`

**Archivo:** `src/features/creator/components/AgentExamples.tsx`  
**Severidad:** MENOR

**Problema:**  
```ts
// fetchExamples definido como useCallback
const fetchExamples = useCallback(async () => {
  const res = await fetch(`/api/creator/agents/${agentId}/examples`)
  ...
}, [agentId])

// useEffect — NO usa fetchExamples, duplica la lógica inline
useEffect(() => {
  activeRef.current = true
  const run = async () => {
    const res = await fetch(`/api/creator/agents/${agentId}/examples`)
    ...
  }
  run()
  return () => { activeRef.current = false }
}, [agentId])
```

`fetchExamples` solo se usa en `handleSubmit` para refrescar post-submit. El `useEffect` inicial no lo usa, duplicando la lógica. Si la URL o el parsing cambia, hay que actualizar dos lugares.

**Fix recomendado:** Usar `fetchExamples` dentro del `useEffect`, o eliminar el `useCallback` y unificar.

---

## OK — Confirmado correcto

| # | Check | Resultado |
|---|-------|-----------|
| OK-01 | Auth check en GET/POST/PATCH/DELETE ejemplos | ✅ Todos verifican `auth.getUser()`, 401 si no hay sesión |
| OK-02 | Ownership check en POST | ✅ Verifica `agents.creator_id = user.id` antes de insertar |
| OK-03 | Ownership check en PATCH/DELETE | ✅ `.eq('creator_id', user.id)` en la query + protegido por RLS |
| OK-04 | SQL injection | ✅ Sin raw SQL en rutas API; todo vía Supabase client parametrizado |
| OK-05 | Datos simulados en producción | ✅ Sin mocks/fixtures en código de producción |
| OK-06 | Hardcodes de URLs/secrets | ✅ Sin hardcodes de API keys, addresses o endpoints externos |
| OK-07 | SSRF | ✅ Sin endpoints que acepten URLs de usuario |
| OK-08 | `getAgentReputation` cache key | ✅ `unstable_cache` usa `keyParts + serialized args` → diferente entrada por agentId |
| OK-09 | RLS `agent_examples_public_read` | ✅ `USING (true)` correcto para lectura pública |
| OK-10 | Escalada de privilegios creator→creator | ✅ `.eq('creator_id', user.id)` en todas las mutaciones + RLS doble-check |
| OK-11 | Validación de inputs en POST/PATCH | ✅ Longitud validada en API; `trim()` aplicado; tipos chequeados |
| OK-12 | `MobileBottomNav` | ✅ No expone datos sensibles; `userRole` viene del server (sin fetch en cliente) |
| OK-13 | Reputation: datos de usuario en respuesta | ✅ Solo métricas agregadas, sin PII |
| OK-14 | Fallback reputation usa Service Client correctamente | ✅ `createServiceClient()` para lectura interna desde server; apropiado para RPC/cache |

---

## Resumen ejecutivo

Sprint 8 tiene **1 BLOQUEANTE real** (race condition en límite de ejemplos) y **4 MENORES** (2 de seguridad/solidez, 2 de calidad de código).

La lógica de autenticación, ownership checks y RLS están bien implementados — no hay bypass de auth ni escalada de privilegios. El riesgo principal es que un creator malicioso o con conexión inestable puede acumular más de 5 ejemplos por timing de requests concurrentes.

**Requerido antes de QA:** Resolver B-01 con un constraint en DB o INSERT condicional.

---
*Generado automáticamente por el agente AR del BMAD Method v6*
