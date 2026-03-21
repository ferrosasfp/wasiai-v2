# Logic Audit — WAS-246 (commit `16ea8e42b`)

**Auditor:** Logic Auditor (subagent)  
**Fecha:** 2026-03-19  
**Archivos auditados:**
- `src/app/api/v1/onboard/step/route.ts`
- `src/app/api/v1/onboard/[session_id]/route.ts`
- `src/app/api/v1/onboard/start/route.ts`

---

## AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|--------------|---------------|--------|
| AC-01: POST /api/v1/onboard/{session_id} con {answer} funciona igual que POST /step | ✅ | `[session_id]/route.ts:26-42`, `step/route.ts:225-243` | **PASS** |
| AC-02: Session inválida → 404 {error: "Session not found or expired"} | ✅ | `step/route.ts:35-42` | **PASS** |
| AC-03: POST /api/v1/onboard/step sigue funcionando (backward compat) | ✅ | `step/route.ts:225-243` | **PASS** |
| AC-04: Sin duplicación — lógica en función exportada `processOnboardStep` | ✅ | `step/route.ts:29` (export), `[session_id]/route.ts:3` (import) | **PASS** |
| AC-05: POST /start responde con `next_url: "/api/v1/onboard/{session_id}"` | ✅ | `start/route.ts:26` | **PASS** |
| AC-06: No nuevas dependencias npm | ✅ | — | **PASS** |

---

## Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| 1 | **BLOQUEANTE** | **Step 6 (tags) permite respuesta vacía**, pero los handlers POST rechazan `answer === ''` con 400 antes de llegar a `processOnboardStep`. En step 6, el código permite `answer === 'skip'` o `answer.trim() === ''` (línea 119), pero nunca alcanza esa lógica porque la validación del POST rechaza strings vacíos primero. | `step/route.ts:238`, `[session_id]/route.ts:38` |
| 2 | MENOR | La validación `answer === ''` solo rechaza strings vacíos literales. **Valores como `0` (número) o `false` (booleano) pasan**, lo cual podría no ser intencional. Considerar validación más estricta si se esperan solo strings. | `step/route.ts:238`, `[session_id]/route.ts:38` |

---

## Corrección lógica

✅ `processOnboardStep` correctamente exportada desde `step/route.ts` (línea 29)  
✅ `[session_id]/route.ts` importa correctamente de `../step/route` (línea 3)  
✅ La lógica del wizard **no fue alterada** — solo refactorizada  
✅ POST handler en `[session_id]/route.ts` **toma `session_id` de params (URL)**, no del body  

---

## Edge cases

### 🔴 Bug confirmado: Step 6 imposible completar con respuesta vacía

**Escenario:**
1. Usuario llega a step 6 (tags)
2. Usuario quiere saltarlo enviando `answer = ""`
3. Handler POST rechaza con `{"error": "answer is required"}` (400)
4. Nunca llega a la lógica de step 6 que **permitiría** vacío o "skip"

**Código afectado:**
```typescript
// step/route.ts:238 y [session_id]/route.ts:38
if (answer === null || answer === undefined || answer === '') {
  return NextResponse.json({ error: 'answer is required' }, { status: 400 })
}
```

**Lógica en step 6 (nunca alcanzada):**
```typescript
// step/route.ts:119
if (answer === 'skip' || (typeof answer === 'string' && answer.trim() === '')) {
  data.tags = []
}
```

**Fix sugerido:**
Remover `|| answer === ''` de la validación del handler POST, o permitir vacío solo en step 6.

---

## Error handling

✅ JSON parsing manejado con try-catch en ambos handlers POST  
✅ Validación de `session_id` presente  
⚠️ Validación de `answer` **demasiado estricta** (ver Finding #1)  

---

## Veredicto

🔴 **REQUIERE CORRECCIÓN**

**Razón:** Finding #1 es bloqueante. El step 6 está **roto** — los usuarios no pueden saltarlo con respuesta vacía como el código interno sugiere que deberían poder.

**Acción requerida:**
1. Ajustar validación de `answer` en handlers POST para permitir strings vacíos (o solo en step 6)
2. Re-testear flujo completo de onboarding incluyendo skip en step 6
3. Considerar validación más estricta de tipos si se esperan solo strings (Finding #2)

---

**Firma:** Logic Auditor  
**Commit auditado:** `16ea8e42b`  
**Status:** ❌ FAIL (1 bug bloqueante encontrado)
