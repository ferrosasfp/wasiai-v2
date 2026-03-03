# Adversarial Review 028 — WAS-41 LlamaIndex Plugin

**Fecha:** 2026-03-02  
**NNN:** 028  
**Package:** `llama-index-wasiai` (`wasiai-llamaindex/`)  
**Commit:** `4a0f1c1`  
**Reviewer:** Adversary (NexusAgil QUALITY)  
**Veredicto:** ✅ **APROBADO** — 0 bloqueantes, 2 menores

---

## Tabla de Hallazgos

| # | Categoría | Severidad | Hallazgo |
|---|-----------|-----------|----------|
| 1 | API key leakage | ✅ OK | La API key va exclusivamente en el header `X-API-Key`. No aparece en logs, mensajes de error ni stack traces. El test `AC4` valida explícitamente que no está en el mensaje de error. |
| 2 | Request forgery | ✅ OK | `query` entra en el body vía `JSON.stringify({ input: input.query })` — el serializer escapa cualquier carácter especial. `slug` pasa por `encodeURIComponent`. No hay interpolación cruda de headers. |
| 3 | Timeout | ⚠️ MENOR | `AbortSignal.timeout()` requiere Node ≥ 17.3. El campo `engines: { node: ">=18" }` es la única protección — no hay fallback ni verificación en runtime. Si alguien ignora el engines field, obtendrá `TypeError: AbortSignal.timeout is not a function` sin mensaje claro. |
| 4 | Error handling | ⚠️ MENOR | El `detail` del error HTTP se extrae del body del servidor sin truncado. Un servidor mal configurado podría devolver HTML verbose o stack traces propios (ej. Vercel 500), exponiendo información del backend en el mensaje de error al LLM. Aplica a paths de error `!response.ok`. |
| 5 | peerDependencies | ✅ OK | `llamaindex` está correctamente en `peerDependencies`. También en `devDependencies` para testing (correcto). El package no lo bundlea. `files: ["dist/", "README.md"]` excluye fuentes y tests. |
| 6 | ESM compliance | ✅ OK | `"type": "module"` en package.json. Test importa con extensión `.js` (`'../src/index.js'`). Cero `require()`. Imports de node_modules sin extensión (correcto). |
| 7 | Constraint Directives | ✅ OK | `call()` retorna `Promise<string>` — siempre. `String(text)` como cast final garantiza el contrato. Sin ethers.js, sin axios. Usa `fetch` nativo. |
| 8 | npm publish safety | ✅ OK | `files: ["dist/", "README.md"]` — `test/`, `src/`, `examples/` no se publican. `prepublishOnly` ejecuta build antes de publicar. `publishConfig.access: "public"` configurado. |

---

## Detalle de Menores

### MENOR-1: Timeout sin fallback (categoría 3)

**Riesgo:** Bajo — el engines field protege la mayoría de los casos. Pero un usuario con NVM o toolchain antiguo puede ver un error críptico.

**Recomendación:**
```typescript
// Antes de usar AbortSignal.timeout
if (typeof AbortSignal.timeout !== 'function') {
  throw new Error('WasiAITool requiere Node >= 18 (AbortSignal.timeout no disponible)')
}
```
O simplemente documentarlo claramente en el README con `> **Requires Node 18+**`.

### MENOR-2: Error detail sin truncado (categoría 4)

**Riesgo:** Bajo — la API key no está en el body, pero un server error verboso podría exponer paths internos de Vercel al agente LLM.

**Recomendación:**
```typescript
// Truncar detail a 200 chars para evitar noise
detail = detail.slice(0, 200)
```

---

## Resultado Final

| Bloqueantes | Menores | OK |
|-------------|---------|-----|
| 0 | 2 | 6 |

✅ **APROBADO para avanzar a Code Review / QA.**  
Los 2 menores pueden corregirse en un micro-patch o dejarse documentados como known limitation sin bloquear el flujo.
