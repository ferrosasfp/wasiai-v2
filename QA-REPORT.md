# QA Report — WasiAI v2 Automated Testing

**Fecha**: 2026-03-05
**Ejecutor**: Claude QA Agent
**Scope**: Unit + Component tests (Vitest)
**Worktree**: `recursing-herschel`

---

## Resumen Ejecutivo

| Metrica | Valor |
|---------|-------|
| Test files totales | 30 |
| Tests totales | 412 |
| Tests PASSING | 401 (97.3%) |
| Tests FAILING | 11 (2.7%) |
| Archivos con failures | 3 (pre-existentes) |
| Tests nuevos creados | ~350 |
| Tiempo de ejecucion | ~6.75s |

---

## Tests Creados por Fase

| Fase | Tests | Archivos | Cobertura |
|------|-------|----------|-----------|
| 0 - Infraestructura | 0 | 5 | Helpers compartidos, CI, vitest config |
| 1 - Security | 90 | 4 | SSRF, CSRF, USDC atomics, Zod schemas |
| 2 - Services | 57 | 3 | agent-keys service, models service, ratelimit |
| 3 - API Routes | 80 | 8 | invoke, register, discover, rate, catalog, keys, stats |
| 4 - Web3 Contracts | 28 | 2 | marketplaceClient, usdcSettler |
| 5 - Middleware + UI | 43 | 3 | middleware auth/CSP, CollectionCard, ModelCard |
| **Total nuevos** | **~298** | **25** | |

---

## Hallazgos (Failures Pre-existentes)

### HALLAZGO 1: `src/actions/__tests__/auth.test.ts` — 2 tests failing

**Severidad**: MEDIA
**Tests afectados**:
- `login > should call signInWithPassword with valid data and redirect`
- `updatePassword > should update password and redirect on success`

**Causa raiz**: Los tests esperan `redirect('/en/dashboard')` pero el codigo fuente en `src/actions/auth.ts` redirige a `/${locale}/creator/dashboard` (linea 61 y 146). El path cambio de `/en/dashboard` a `/en/creator/dashboard` cuando se reestructuraron las rutas del creator, pero los tests no se actualizaron.

**Correccion sugerida**:
```typescript
// auth.test.ts linea 157 — CAMBIAR:
expect(redirect).toHaveBeenCalledWith('/en/dashboard')
// POR:
expect(redirect).toHaveBeenCalledWith('/en/creator/dashboard')

// auth.test.ts linea 330 — CAMBIAR:
expect(redirect).toHaveBeenCalledWith('/en/dashboard')
// POR:
expect(redirect).toHaveBeenCalledWith('/en/creator/dashboard')
```

**Archivos a modificar**: `src/actions/__tests__/auth.test.ts` (2 lineas)

---

### HALLAZGO 2: `src/actions/__tests__/storage.test.ts` — 5 tests failing

**Severidad**: ALTA
**Tests afectados**:
- `uploadFile > should upload successfully with valid file and no metadata`
- `uploadFile > should upload successfully with valid file and metadata`
- `deleteFile > should delete successfully with valid CIDv0`
- `deleteFile > should delete successfully with valid CIDv1`
- `deleteFile > should return error when provider delete throws`

**Causa raiz (uploadFile)**: Los tests esperan `{ success: true, cid: '...' }` pero reciben `{ error: '...' }`. El mock de Supabase auth no esta configurado correctamente — `createClient()` no retorna un client con `auth.getUser()` que devuelva un usuario autenticado, por lo que `storage.ts` linea 36 obtiene `user = null` y retorna `{ error: 'Not authenticated' }`.

**Causa raiz (deleteFile)**: `TypeError: supabase.from is not a function` — El mock de `createClient()` retorna un objeto que tiene `auth.getUser()` pero NO tiene `from()`. El `deleteFile` en `storage.ts` linea 112-139 llama `supabase.from('user_files')` y falla porque el mock es incompleto.

**Correccion sugerida**:
```typescript
// storage.test.ts — El mock de createClient necesita:
// 1. auth.getUser() que devuelva un usuario autenticado
// 2. from() con chain completa (select, eq, single, insert, delete, update)

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
      }),
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'file-1' }, error: null }),
      delete: vi.fn().mockReturnThis(),
    }),
  }),
}))
```

**Archivos a modificar**: `src/actions/__tests__/storage.test.ts` (mock de createClient)

---

### HALLAZGO 3: `src/features/contracts/__tests__/ContractWriter.test.tsx` — 4 tests failing

**Severidad**: MEDIA
**Tests afectados**:
- `should render submit button`
- `should disable submit when address is empty`
- `should disable submit when functionName is empty`
- `should show parse error when invalid JSON is submitted`

**Causa raiz**: `TestingLibraryElementError: Found multiple elements with the role "button" and name "write"` y `Found multiple elements with the placeholder text of: Function name (e.g. mint)`. El componente `ContractWriter.tsx` renderiza DOS formularios (read + write) cada uno con su propio boton "write" e input "Function name". El test usa `screen.getByRole('button', { name: /write/i })` que encuentra multiples matches.

**Correccion sugerida**:
```typescript
// ContractWriter.test.tsx — CAMBIAR:
const submitButton = screen.getByRole('button', { name: /write/i })
// POR (opcion A — usar getAllByRole y tomar el correcto):
const submitButtons = screen.getAllByRole('button', { name: /write/i })
const submitButton = submitButtons[1] // segundo boton es el del form write

// O MEJOR (opcion B — buscar dentro del form correcto):
const forms = screen.getAllByRole('form')
const writeForm = forms[1] // o usar data-testid
const submitButton = within(writeForm).getByRole('button', { name: /write/i })

// Para el input:
const functionNameInput = screen.getByPlaceholderText('Function name (e.g. mint)')
// CAMBIAR A:
const functionNameInputs = screen.getAllByPlaceholderText('Function name (e.g. mint)')
const functionNameInput = functionNameInputs[1] // write form
```

**Alternativa recomendada**: Agregar `data-testid` al componente `ContractWriter.tsx` para disambiguar:
```tsx
// En ContractWriter.tsx, agregar al form de escritura:
<form data-testid="write-form" className="space-y-3" onSubmit={handleWrite}>
```

**Archivos a modificar**:
- `src/features/contracts/__tests__/ContractWriter.test.tsx` (queries)
- Opcionalmente: `src/features/contracts/components/ContractWriter.tsx` (data-testid)

---

## Archivos Nuevos Creados (para merge)

### Infraestructura (FASE 0)
```
src/__tests__/helpers/supabase-mock.ts    — Factory de Supabase mock chainable
src/__tests__/helpers/request-mock.ts     — Builder de NextRequest
src/__tests__/helpers/viem-mock.ts        — Mock de viem clients
src/__tests__/helpers/index.ts            — Barrel export
.github/workflows/test.yml               — CI para unit tests (Node 20)
vitest.config.ts                          — MODIFICADO: coverage include expandido
```

### Tests (FASE 1-5)
```
src/lib/security/__tests__/validateEndpointUrl.test.ts     — 31 tests (SSRF)
src/lib/security/__tests__/csrf.test.ts                    — 11 tests (CSRF)
src/lib/contracts/__tests__/WasiAIMarketplace.test.ts      — 14 tests (USDC atomics)
src/lib/schemas/__tests__/api.schemas.test.ts              — 34 tests (Zod)
src/features/agent-api/services/__tests__/agent-keys.service.test.ts — 18 tests
src/features/models/services/__tests__/models.service.test.ts        — 14 tests
src/lib/__tests__/ratelimit.test.ts                        — 25 tests (ACTUALIZADO)
src/app/api/v1/agents/discover/__tests__/route.test.ts     — 11 tests
src/app/api/v1/agent-keys/me/__tests__/route.test.ts       — 8 tests
src/app/api/v1/creator/stats/__tests__/route.test.ts       — 7 tests
src/app/api/v1/models/[slug]/invoke/__tests__/route.test.ts — 14 tests
src/app/api/v1/agents/register/__tests__/route.test.ts     — 12 tests
src/app/api/v1/models/[slug]/rate/__tests__/route.test.ts  — 10 tests
src/app/api/v1/agents/__tests__/route.test.ts              — 8 tests
src/app/api/agent-keys/__tests__/route.test.ts             — 10 tests
src/lib/contracts/__tests__/marketplaceClient.test.ts      — 16 tests
src/lib/contracts/__tests__/usdcSettler.test.ts            — 12 tests
middleware.test.ts                                          — 17 tests
src/features/collections/__tests__/CollectionCard.test.tsx  — 12 tests
src/features/models/__tests__/ModelCard-badges.test.tsx     — 14 tests
```

### Soporte
```
src/__mocks__/lucide-react.tsx            — Stub para iconos en tests
```

---

## Archivos Sincronizados desde Main

Estos archivos fueron copiados del repo principal al worktree porque el worktree estaba desactualizado:

```
src/lib/ratelimit.ts                      — Version con try/catch 503, creator limits
src/app/api/v1/agents/discover/route.ts   — CM-04 discovery API
```

---

## Patrones de Mock Documentados

Para que el equipo de desarrollo mantenga los tests consistentes:

### 1. Supabase Chain Mock (thenable)
```typescript
const mockChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
  // Para queries que se awaitan directamente (sin .single()):
  then: (resolve: Function) => Promise.resolve({ data: mockData, error: null }).then(resolve),
  catch: (reject: Function) => Promise.resolve({ data: mockData, error: null }).catch(reject),
}
```

### 2. Route Handler Testing
```typescript
import { GET, POST } from '../route'
const request = new NextRequest('http://localhost/api/...', { method: 'POST', body: JSON.stringify(data) })
const response = await POST(request, { params: Promise.resolve({ slug: 'test' }) })
const body = await response.json()
expect(response.status).toBe(200)
```

### 3. Env-dependent Modules (top-level const)
```typescript
beforeEach(() => {
  vi.resetModules()
  process.env.MY_VAR = 'test-value'
})
// Dynamic import AFTER env is set:
const { myFunction } = await import('../myModule')
```

---

## Recomendaciones

1. **Corregir los 3 hallazgos** antes de merge (estimado: 30 min)
2. **Merge del worktree** al branch principal despues de correccion
3. **Ejecutar `npm run qa`** (typecheck + lint + test + build) como gate final
4. **Verificar CI** en GitHub Actions con el nuevo workflow `.github/workflows/test.yml`
5. **Coverage target**: Con estos tests, el coverage deberia superar 60% en statements y 50% en branches (los thresholds configurados en vitest.config.ts)
