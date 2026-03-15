# SDD #077: DEUDA — Docs: corregir input serializado como string

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: bugfix
> SDD_MODE: bugfix
> Clasificación: FAST-FIX

---

## 1. Resumen del bug

Los ejemplos de código en la documentación muestran `input` como JSON serializado (string), lo que induce al desarrollador a enviar `{"input": "{\"token\":\"AVAX\"}"}` en lugar de `{"input": {"token": "AVAX"}}`. Esto produce el mismo error que encontramos en la UI (`Input validation failed`).

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 077 |
| **Tipo** | bugfix |
| **Objetivo** | Corregir ejemplos en docs para que muestren input como objeto, no string serializado |
| **Scope IN** | `sdk-node.tsx`, `agent-keys.tsx`, `compose.tsx` en `src/features/docs/content/` |
| **Scope OUT** | No tocar `x402.tsx` (su `JSON.stringify` es para el payload de pago, no el input), no tocar lógica funcional |

---

## 3. Archivos afectados

| Archivo | Acción | Qué cambia |
|---------|--------|-----------|
| `src/features/docs/content/sdk-node.tsx` | Modificar | L32, L76: `input: JSON.stringify({...})` → `input: {...}` (objeto directo) |
| `src/features/docs/content/agent-keys.tsx` | Modificar | L44: `input: JSON.stringify({...})` → `input: {...}` |
| `src/features/docs/content/compose.tsx` | Modificar | L13, L17, L39, L44 (×4): `"input": "{...}"` → `"input": {...}` |

---

## 4. Ejemplos — antes/después

### sdk-node.tsx L32
```typescript
// ANTES
input: JSON.stringify({ token_name: 'AVAX', token_symbol: 'AVAX' })

// DESPUÉS
input: { token_name: 'AVAX', token_symbol: 'AVAX' }
```

### compose.tsx L13
```typescript
// ANTES
"input": "{\"feed_address\":\"0x..\",\"token_symbol\":\"AVAX\"}"

// DESPUÉS
"input": { "feed_address": "0x..", "token_symbol": "AVAX" }
```

---

## 5. Acceptance Criteria (EARS)

1. WHEN un developer copia el ejemplo de `sdk-node`, THE código resultante SHALL enviar `input` como objeto JSON (no string).
2. WHEN un developer copia el ejemplo de `compose`, THE pipeline SHALL funcionar sin `input_validation_failed`.

---

## 6. Constraint Directives

### PROHIBIDO
- NO tocar `x402.tsx` — su `JSON.stringify` es para el header de pago (correcto)
- NO tocar lógica funcional, solo contenido de strings en los archivos de docs
- NO cambiar estructura de componentes

---

## 7. Wave única

- [ ] W1: Corregir las 7 ocurrencias en los 3 archivos (sdk-node ×2, agent-keys ×1, compose ×4)
- [ ] W2: `npx tsc --noEmit` limpio
- [ ] W3: Visual check: los ejemplos en `/docs` muestran `input` como objeto
