# SDD — WAS-205: Zero-Friction Input en todas las superficies

**Issue:** WAS-205 | **Clasificación:** HU-MAJOR | **Fecha:** 2026-03-15 | **Depende de:** WAS-206, DEUDA-01

---

## Context

Conectar Sandbox y TryIt de Docs con el campo `example_input` resuelto que DEUDA-01 expone en la API. Reemplazar `EXAMPLE_PAYLOADS` hardcodeado. El Free Trial ya tiene el prop `inputExample` conectado (WAS-206 migró los usos).

**Archivos a modificar:**
- `src/app/[locale]/sandbox/SandboxClient.tsx`
- `src/features/docs/components/TryIt.tsx`

**NO tocar:**
- `AgentTrialPlayground.tsx` — ya corregido en WAS-206
- `CodeExamples.tsx` — ya funciona correctamente

---

## Wave 0 — Pre-flight

```bash
# Verificar que API expone example_input (DEUDA-01 debe estar DONE)
curl -s "https://app.wasiai.io/api/v1/agents/wasi-chainlink-price" | python3 -c "import json,sys; d=json.load(sys.stdin); print('example_input:', d.get('example_input', 'MISSING'))"
# Expected: example_input: {"token": "AVAX"}

# Verificar EXAMPLE_PAYLOADS hardcodeado aún existe
grep -n "EXAMPLE_PAYLOADS\|buildExampleFromSchema" src/app/\[locale\]/sandbox/SandboxClient.tsx
grep -n "EXAMPLE_PAYLOADS\|buildExampleFromSchema" src/features/docs/components/TryIt.tsx
```

---

## Wave 1 — SandboxClient.tsx

**Cambio:** Reemplazar `EXAMPLE_PAYLOADS` hardcodeado + `buildExampleFromSchema` local por fetch dinámico del `example_input` de la API al seleccionar agente.

**Pre-flight Wave 1:**
- SandboxClient.tsx NO tiene función `handleSlugChange` — el slug change es inline en el `onChange` del select. Wave 1 debe crear dicha función.
- `buildExampleFromSchema` local está en línea 24 — eliminar después de migrar.
- `placeholder` del textarea usaba `buildExampleFromSchema` — después de eliminar, usar string literal `'{"input": ""}'`.

```typescript
// ELIMINAR funciones locales:
// - buildExampleFromSchema (línea ~24)
// MANTENER el resto del componente

// AGREGAR estado dirty y función fetchExampleInput:
const [inputDirty, setInputDirty] = useState(false)

const fetchExampleInput = useCallback(async (slug: string) => {
  try {
    const res = await fetch(`/api/v1/agents/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(5_000)
    })
    if (!res.ok) return
    const data = await res.json() as { example_input?: string }
    if (data.example_input && !inputDirty) {
      setInputText(data.example_input)
    }
  } catch {
    if (!inputDirty) setInputText('{"input": ""}')
  }
}, [inputDirty])

// CREAR handleSlugChange que reemplaza el inline onChange:
function handleSlugChange(newSlug: string) {
  setSelectedSlug(newSlug)
  setInputDirty(false) // reset dirty al cambiar de agente
  void fetchExampleInput(newSlug)
}

// En el textarea de input — agregar onBlur o onChange para marcar dirty:
onChange={e => { setInputText(e.target.value); setInputDirty(true) }}

// En el select de agente — reemplazar onChange inline por handleSlugChange:
onChange={e => handleSlugChange(e.target.value)}

// Placeholder del textarea después de eliminar buildExampleFromSchema local:
placeholder='{"input": ""}'

// En useEffect de carga inicial — pre-cargar ejemplo del primer agente:
if (list.length > 0 && !selectedSlug) {
  const firstSlug = list[0].slug
  setSelectedSlug(firstSlug)
  void fetchExampleInput(firstSlug)
}
```

**Build gate Wave 1:**
```bash
npx tsc --noEmit 2>&1 | grep "SandboxClient" | head -5
```

---

## Wave 2 — TryIt.tsx

**Cambio:** Reemplazar `EXAMPLE_PAYLOADS` hardcodeado por fetch dinámico al cambiar slug.

**Pre-flight Wave 2:**
- TryIt.tsx SÍ tiene `handleSlugChange` (función existente, no async) — convertirla a async puede causar conflictos de tipo si es usada como callback. Mejor: crear `fetchAndSetPayload(slug)` separado y llamarlo desde `handleSlugChange`.
- Agregar estado dirty igual que en Wave 1.

```typescript
// ELIMINAR:
const EXAMPLE_PAYLOADS: Record<string, string> = { ... }
function getExamplePayload(slug: string): string { ... }

// AGREGAR estado dirty:
const [payloadDirty, setPayloadDirty] = useState(false)

// AGREGAR función de fetch separada (no async en el handler):
async function fetchAndSetPayload(newSlug: string) {
  try {
    const res = await fetch(`/api/v1/agents/${encodeURIComponent(newSlug)}`, {
      signal: AbortSignal.timeout(5_000)
    })
    if (res.ok) {
      const data = await res.json() as { example_input?: string }
      if (!payloadDirty) setPayload(data.example_input ?? '{"input": ""}')
    }
  } catch {
    if (!payloadDirty) setPayload('{"input": ""}')
  }
}

// MODIFICAR handleSlugChange existente — mantener sync, llamar void fetch:
function handleSlugChange(newSlug: string) {
  setSlug(newSlug)
  setPayloadDirty(false) // reset dirty al cambiar agente
  void fetchAndSetPayload(newSlug)
}

// En el textarea de payload — marcar dirty al editar:
onChange={e => { setPayload(e.target.value); setPayloadDirty(true) }}

// En useEffect de carga inicial — pre-cargar primer agente:
if (list.length > 0) {
  const firstSlug = list[0].slug
  setSlug(firstSlug)
  void fetchAndSetPayload(firstSlug)
}
```

**Build gate Wave 2:**
```bash
npx tsc --noEmit 2>&1 | grep "TryIt" | head -5
```

---

## Wave 3 — Build final + commit

```bash
npx tsc --noEmit 2>&1 | head -10
# Verificar que no quedan EXAMPLE_PAYLOADS hardcodeados
grep -rn "EXAMPLE_PAYLOADS" src/ --include="*.tsx" --include="*.ts"
# Expected: 0 resultados
git add src/app/\[locale\]/sandbox/SandboxClient.tsx src/features/docs/components/TryIt.tsx
git commit -m "feat(WAS-205): replace hardcoded EXAMPLE_PAYLOADS with dynamic API fetch in Sandbox and TryIt"
git push
```

---

## Rollback

```bash
git revert HEAD --no-edit && git push
```

---

## Critical Constraints

- **PROHIBIDO** resetear el input si el usuario ya lo modificó manualmente
- Los fetches tienen timeout de 5s y degradan gracefully (no bloquean la UI)
- No tocar `AgentTrialPlayground.tsx` ni `CodeExamples.tsx`
- El fetch se hace al cambiar el select, no en cada render
