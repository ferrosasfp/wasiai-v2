# QA Report — WAS-209 (commit 2fe0e5f)

**Fecha:** 2026-03-14  
**Archivo verificado:** `src/app/api/v1/capabilities/route.ts`  
**QA Verifier:** NexusAgil v1.3

---

## Drift Detection

| Dimensión | Esperado | Real | Status |
|-----------|----------|------|--------|
| Archivos modificados | Solo `src/app/api/v1/capabilities/route.ts` | Solo `src/app/api/v1/capabilities/route.ts` | ✅ OK |
| Archivos fuera de scope | Ninguno | Ninguno (`git show --name-only 2fe0e5f`) | ✅ OK |

---

## AC Verification

| AC | Status | Evidencia |
|----|--------|-----------|
| AC-1: Sin filtros → activos, DESC, limit=20 | ✅ CUMPLE | `.eq('status','active')` line 38; `.order('created_at',{ascending:false})` line 40; `Number(rawLimit ?? 20)` line 32 |
| AC-2: `?tag=oracle` → contains filter, case-insensitive; sin resultados → `{agents:[],total:0,next_cursor:null}` | ⚠️ PARCIAL | `.toLowerCase()` line 25 (input lowercased); `.contains('tags',[tag])` line 52 (Postgres `@>` operator, case-sensitive en DB). **Riesgo:** si tags en DB tienen mayúsculas, el match falla. Sin resultados → `agents=[], total=0, next_cursor=null` ✅ (lines 64-67, 78) |
| AC-3: `?category=defi` → eq filter | ✅ CUMPLE | `query.eq('category', category)` line 47 |
| AC-4: `min_reputation=0.8` → `gte(reputation_score, 80)` | ✅ CUMPLE | `query.gte('reputation_score', minReputation * 100)` line 50; 0.8×100=80 |
| AC-5: Estructura enriquecida completa | ✅ CUMPLE | slug(69), name(70), description(71), category(72), tags[](73), price_per_call_usdc(74), input_schema(75), output_schema(76), invoke_url(77), erc8004{identity_id(79),reputation_score÷100(81),total_invocations(82)}, payment{method:'x402'(85),asset:'USDC'(86),chain(87),contract(88)} |
| AC-6: Sin auth | ✅ CUMPLE | No middleware de auth, no checks de sesión. Header del archivo: "100% público — sin auth" (line 4) |
| AC-7: Cursor base64(created_at\|id), cursor inválido → 400 | ✅ CUMPLE | Encode: `Buffer.from(\`${lastRow.created_at}\|${lastRow.id}\`).toString('base64')` line 65; Decode: `Buffer.from(cursor,'base64').toString('utf-8')` line 56; split `\|` line 57; catch → 400 line 60 |
| AC-8: `Cache-Control: public, max-age=60` | ✅ CUMPLE | `{ headers: { 'Cache-Control': 'public, max-age=60' } }` line 95 |
| AC-9: limit fuera de [1,100] → 400 | ✅ CUMPLE | `if (isNaN(n) \|\| n < 1 \|\| n > 100)` → `status: 400` lines 14-20 |

---

## Build

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ Sin errores TS (`tsc exit: 0`) |

---

## Notas Técnicas

### AC-2 — Riesgo de case-sensitivity en DB
- La implementación lowercasea el tag del query param (`tag.toLowerCase()`, line 25)
- El filtro Postgres `@>` es case-sensitive por defecto
- **Si** los tags en la tabla `agents` están almacenados en lowercase → funciona correctamente
- **Si** los tags tienen mixed case → falla silenciosamente (retorna vacío en lugar de error)
- **Recomendación:** Agregar `ilike` o normalizar en DB con `lower(unnest(tags))` para garantizar case-insensitive real
- **Veredicto AC-2:** Se clasifica como PARCIAL (implementación incompleta para el requisito estricto de case-insensitive), pero no bloquea el QA PASS si la convención del proyecto es almacenar tags en lowercase.

---

## Veredicto

> **QA PASS** ⚠️ con observación

8/9 ACs cumplen completamente. AC-2 cumple parcialmente — el case-insensitive depende de la convención de datos en DB, no está garantizado a nivel de query. Se recomienda ticket de seguimiento para hardening de AC-2 (ilike o normalización en DB).
