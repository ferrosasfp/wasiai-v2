# Story File #016 — WAS-81: meta.charged = totalPrice
> Architect · SPEC_APPROVED · 2026-03-01
> Dev SOLO lee este archivo. No consultar SDD ni Work Item.

---

## Goal
Corregir `meta.charged` en la respuesta de invocaciones para que refleje el `totalPrice` real (creator_price + platform_overhead) en vez del `price_per_call` histórico. Agregar `meta.charged_breakdown`. Bump SDK a 0.2.1.

---

## Acceptance Criteria

| # | AC |
|---|---|
| AC1 | WHEN invocación exitosa, THE `meta.charged` SHALL ser `totalPrice` (creator + overhead) |
| AC2 | WHEN invocación exitosa, THE response SHALL incluir `meta.charged_breakdown: { creator, overhead }` |
| AC3 | WHEN se publica fix, THE SDK `@wasiai/sdk` SHALL ser versión `0.2.1` con CHANGELOG |
| AC4 | WHEN Route A falla antes de éxito, THE `meta.charged` SHALL ser `0` — WHEN Route B falla después del pago, THE `meta.charged` SHALL ser `totalPrice` |

---

## Archivos a modificar

| Archivo | Acción |
|---|---|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | MODIFICAR — `buildResponse()` lógica de charged |
| `wasiai-sdk/src/` (buscar package.json) | MODIFICAR — bump version 0.2.1 + CHANGELOG |

---

## Wave 1 — invoke route

### src/app/api/v1/models/[slug]/invoke/route.ts

Localizar `buildResponse()` — buscar el bloque:
```typescript
charged: model.price_per_call,  // mantener para compatibilidad SDK
```

**Reemplazar con:**
```typescript
charged: result.status === 'success'
  ? (pricingInfo?.totalPrice ?? Number(model.price_per_call))
  : 0,
charged_breakdown: result.status === 'success' && pricingInfo
  ? { creator: pricingInfo.creatorPrice, overhead: pricingInfo.overhead }
  : undefined,
```

**Regla:**
- `success` + `pricingInfo` → `charged = totalPrice`
- `success` + sin `pricingInfo` (fallback) → `charged = model.price_per_call`
- `error` (cualquier route) → `charged = 0`

⚠️ NO tocar `signReceipt()` — sigue recibiendo `amountUsdc = creatorPrice`.
⚠️ NO tocar el campo `pricing` que ya existe — solo modificar `meta.charged`.

---

## Wave 2 — SDK bump

### Localizar el SDK

El SDK está en `/home/ferdev/.openclaw/workspace/wasiai-sdk/`.
Buscar `package.json` con: `find /home/ferdev/.openclaw/workspace/wasiai-sdk -name "package.json" -not -path "*/node_modules/*"`

### Cambios:

**package.json** — bump version:
```json
"version": "0.2.1"
```

**CHANGELOG.md** — crear o actualizar con:
```markdown
# Changelog

## [0.2.1] - 2026-03-01

### Changed
- `meta.charged` now reflects the total price paid by the consumer
  (`creator_price + platform_overhead`) instead of just `creator_price`.

### Added
- `meta.charged_breakdown: { creator, overhead }` — breakdown of the charge.

### Deprecated
- Relying on `meta.charged` as the creator's earnings is now incorrect.
  Use `pricing.creator_price` for the creator's share.
  Use `meta.charged` for the total amount paid by the consumer.

### Migration
Before: `const paid = response.meta.charged` (was creator_price only)
After:  `const paid = response.meta.charged` (now totalPrice — no code change needed)
        `const creatorEarnings = response.pricing?.creator_price`
```

---

## Wave 3 — Typecheck + commit

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit  # 0 errores

git add -A
git commit -m "fix(WAS-81): meta.charged = totalPrice + charged_breakdown + SDK 0.2.1"
git push origin master master:main
```

---

## Constraint Directives

**OBLIGATORIO:**
- `result.status === 'success'` controla si charged = totalPrice o 0
- `charged_breakdown` solo aparece en success con pricingInfo
- SDK bump en `wasiai-sdk/` — NO en `wasiai-v2/`
- CHANGELOG.md documenta la migration para developers

**PROHIBIDO:**
- NO modificar `signReceipt()` ni su interfaz
- NO modificar el campo `pricing` existente en la response
- NO modificar Route B (x402) — ya pasa pricingInfo siempre

## Escalation Rule
Si `buildResponse()` no tiene el comentario `// mantener para compatibilidad SDK` — buscar `charged:` dentro de la función y aplicar la lógica igual.
Si el SDK no tiene `package.json` en la raíz — buscarlo con find antes de asumir el path.
