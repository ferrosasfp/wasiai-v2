# Adversarial Review — NNN 026 / WAS-13 CLI `@wasiai/cli`

**Fecha:** 2026-03-02  
**Commit revisado:** `6d8ea24`  
**Revisor:** Adversary (NexusAgil QUALITY)  
**Veredicto:** ⚠️ **CHANGES_REQUESTED**

---

## Tabla de hallazgos

| # | Categoría | Severidad | Hallazgo |
|---|-----------|-----------|----------|
| H1 | SIGINT/SIGTERM | **MENOR** | `SIGTERM` no está manejado. El SDD requiere ambos. |
| H2 | npm publish safety | **MENOR** | `prepublishOnly` ejecuta `node --version` en vez de `npm test`. Tests no se corren antes de publicar. |
| H3 | Timeout / Node < 18 | OK | `AbortSignal.timeout()` requiere Node ≥ 18 — cubierto por `engines: ">=18"`. |
| H4 | API key leakage | OK | Key solo viaja en header `X-API-Key`. Nunca en stdout. Errores HTTP parsean el body (nunca headers). |
| H5 | Injection | OK | Input va por `JSON.stringify({ input })` — escaping seguro. Slug pasa por `encodeURIComponent`. |
| H6 | Exit codes | OK | Todos los paths de error retornan exit 1. Éxito retorna exit 0. Catchall en `parseAsync.catch`. |
| H7 | ESM compliance | OK | Todos los imports con extensión `.js`. `"type": "module"`. Sin `require()`. |
| H8 | Constraint Directives | OK (parcial) | SIGTERM no manejado (ver H1). Rest: sin axios, sin CommonJS, sin secrets hardcodeados. |
| H9 | npm publish safety | OK | `.npmrc` contiene solo `access=public`. `publishConfig.access: "public"` en package.json. Sin secrets en archivos publicables. |

---

## Detalle de hallazgos MENOR

### H1 — SIGTERM no manejado

**Archivo:** `src/commands/invoke.js`  
**Línea referencia:** El código maneja `SIGINT` pero no `SIGTERM`.

```js
// Actual — solo SIGINT
process.on('SIGINT', () => {
  process.stderr.write('\nAborted.\n')
  process.exit(1)
})
```

**Riesgo:** Bajo. El comportamiento default de Node en SIGTERM es terminar limpiamente sin stacktrace (exit 0). Sin embargo, el SDD en Constraint Directives especifica explícitamente:
> _"Manejar SIGINT / SIGTERM limpiamente (no stacktrace al Ctrl+C)"_

El exit code sería 0 en lugar de 1 ante SIGTERM, y no se imprimiría el mensaje `Aborted.`.

**Corrección sugerida:**
```js
const handleSignal = (sig) => {
  process.stderr.write(`\nAborted (${sig}).\n`)
  process.exit(1)
}
process.on('SIGINT', () => handleSignal('SIGINT'))
process.on('SIGTERM', () => handleSignal('SIGTERM'))
```

---

### H2 — `prepublishOnly` no ejecuta tests

**Archivo:** `package.json`  
**SDD especifica:**
```json
"prepublishOnly": "npm test"
```
**Implementado:**
```json
"prepublishOnly": "node --version"
```

**Riesgo:** Medio para calidad. Un `npm publish` puede publicar código no testeado. La guardia de calidad antes de publicar queda desactivada.

**Nota:** Si los tests aún no existen, es válido dejarlo como `"node --version"` temporalmente, pero debe documentarse como deuda técnica o crearse al menos un test mínimo de smoke.

**Corrección:** Agregar test(s) básicos y restaurar `"prepublishOnly": "npm test"`, o documentar la omisión con un TODO.

---

## Análisis detallado por categoría

### 1. API Key Leakage — ✅ OK

- La API key solo se usa en `headers['X-API-Key']`.
- Los errores HTTP se construyen desde `response.text()` (body del response), nunca desde los headers enviados.
- Los errores de red usan `err.message`, que no expone la key.
- El catch global de `parseAsync` imprime `err.message`, sin stack trace.
- Comentario en código: `// API key NUNCA en stdout` — correcto.

### 2. Injection — ✅ OK

- Input del usuario: `JSON.stringify({ input })` — JSON.stringify escapa caracteres especiales. No hay interpolación de strings en el body.
- Slug: `encodeURIComponent(slug)` — previene path traversal e injection en URL.
- No hay ejecución de comandos, eval, ni template literals con input sin sanitizar.

### 3. Exit Codes — ✅ OK

| Path | Exit code |
|------|-----------|
| Sin API key | 1 ✓ |
| Env desconocido | 1 ✓ |
| Timeout / error de red | 1 ✓ |
| HTTP status >= 400 | 1 ✓ |
| SIGINT | 1 ✓ |
| SIGTERM | 0 (default Node) ⚠️ H1 |
| Éxito | 0 ✓ |
| Error no capturado (parseAsync.catch) | 1 ✓ |

### 4. Timeout — ✅ OK

- `AbortSignal.timeout(35_000)` disponible desde Node 18.
- `engines: ">=18"` en package.json.
- Catch diferencia `TimeoutError` y `AbortError` correctamente.
- 35s > 30s del servidor — margen correcto per SDD.

### 5. ESM Compliance — ✅ OK

- Todos los imports locales usan extensión `.js`: `'../config.js'`, `'../output.js'`, `'../src/commands/invoke.js'`.
- `"type": "module"` en package.json.
- Cero ocurrencias de `require()`.

### 6. SIGINT/SIGTERM — ⚠️ MENOR (ver H1)

- SIGINT: manejado limpiamente ✓
- SIGTERM: no manejado explícitamente — usa default de Node (exit sin stacktrace pero exit 0).

### 7. Constraint Directives — ✅ OK (salvo H1)

| Directiva | Estado |
|-----------|--------|
| `"type": "module"` | ✅ |
| Shebang `#!/usr/bin/env node` | ✅ |
| API key nunca en logs/stdout | ✅ |
| Timeout 35s | ✅ |
| SIGINT limpio | ✅ |
| SIGTERM limpio | ⚠️ MENOR |
| Node ≥ 18 | ✅ |
| Sin axios/node-fetch | ✅ |
| Sin CommonJS | ✅ |
| Sin secrets hardcodeados | ✅ |
| Sin deps de wasiai-v2 | ✅ |
| Sin lectura de .env del repo | ✅ |

### 8. npm Publish Safety — ⚠️ MENOR (ver H2)

- `publishConfig.access: "public"` ✅
- `.npmrc` con `access=public` ✅ (solo este valor, sin tokens)
- Sin `.npmignore` — ok, `node_modules/` excluido por default npm
- Archivos publicables: `bin/`, `src/`, `package.json`, `README.md`, `.npmrc` — ninguno con secrets ✅
- `prepublishOnly: "node --version"` en vez de `npm test` ⚠️ H2

---

## Acciones requeridas antes de DONE

| Prioridad | Acción |
|-----------|--------|
| MENOR | Agregar handler `SIGTERM` en `src/commands/invoke.js` |
| MENOR | Restaurar `"prepublishOnly": "npm test"` (con smoke test mínimo) o documentar deuda |

---

## Conclusión

El código es sólido en lo fundamental: no hay leakage de API key, la sanitización es correcta, los exit codes son consistentes y el cumplimiento ESM es impecable. Los dos hallazgos MENOR son correcciones de baja complejidad (~10 líneas en total). Se recomienda corregir antes de `npm publish`.

**Veredicto final: CHANGES_REQUESTED** — 2 hallazgos MENOR, 0 BLOQUEANTES.
