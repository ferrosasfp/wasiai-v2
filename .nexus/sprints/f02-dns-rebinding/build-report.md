## Build Report — F-02

### Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| 1 — validateEndpointUrl.ts | ✅ Done | ✅ Pass | `validateResolvedIPs` → `Promise<string>`, `validateEndpointUrlAsync` → `Promise<string>` retornando primera IP validada |
| 2 — health-probe.ts | ✅ Done | ✅ Pass | Import `node:https`, captura `resolvedIp`, reemplaza `fetch` con `https.request` vía IP con SNI explícito, `dns_rebinding_blocked` reason, timeout 5s |

### Commit
- Hash: `a8cd00b8d`
- Message: `fix(F-02): DNS rebinding — fetch via IP con SNI explícito en probeEndpoint`
- Files changed: 2

### Discrepancias encontradas
- `validateResolvedIPs` puede retornar `''` (string vacío) cuando el módulo DNS no está disponible (Edge runtime) en lugar de lanzar. Se mantiene comportamiento original: si DNS no disponible, el probe de IP se omite silenciosamente y la validación básica (blocklist) aún aplica. El caller (`probeEndpoint`) conectará con string vacío como host, lo que fallará a nivel TCP como `connection_error` — comportamiento seguro.
