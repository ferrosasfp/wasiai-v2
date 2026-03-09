# NEXUS-AUDIT-REPORT v1.0
## @wasiai/sdk — Security Audit Report

**Fecha:** 2026-03-08
**Auditores:** NexusAudit v2.0 (adaptado para SDK) + NexusGuard v1.0 (off-chain)
**Version auditada:** v0.3.0 — commit HEAD main
**Repo:** https://github.com/ferrosasfp/wasiai-sdk
**Score de seguridad:** 7.8 / 10

---

## Executive Summary

`@wasiai/sdk` es un SDK TypeScript puro de lado del cliente (y servidor Node.js) que expone:
- `invokeAgent()` — llamada HTTP a agentes WasiAI via API key
- `discoverAgents()` — descubrimiento publico de agentes
- `publishAgent()` — registro de agentes via API key
- `getCreatorStats()` — estadisticas de creador via API key
- `WasiAITool` / `WasiAIToolkit` — integracion LangChain
- `wasiai` CLI — interfaz de linea de comandos (Commander.js)

**Alcance NexusAudit (on-chain):** No aplicable — el SDK no contiene logica on-chain ni interaccion con contratos inteligentes. Ver seccion NexusAudit Adaptado.

**Alcance NexusGuard (off-chain):** Completo — flujo HTTP, manejo de API keys, validacion de inputs, CLI, cadena de dependencias.

**Hallazgos:** 10 (0 CRITICAL, 2 MEDIUM, 4 LOW, 4 INFO)

---

## NexusAudit — Adaptado para SDK (Sin Contratos)

### SDK-NA-01 — INFO: El SDK no puede verificar estado on-chain de forma independiente

**Categoria:** NexusAudit SDK | **Severidad:** INFO

El SDK es un cliente HTTP puro. No tiene capacidad para verificar de forma independiente:
- Que el agente invocado esta realmente registrado on-chain en el contrato WasiAI.
- Que el pago de la API key fue correctamente liquidado on-chain.
- Que el `recordInvocation()` fue llamado por el backend tras el cobro.

Si el backend WasiAI fuera comprometido, el SDK no tiene mecanismo de verificacion criptografica independiente. Esto es aceptable para v0.x dado el estadio del proyecto, pero deberia documentarse como limitacion conocida.

**Riesgo:** Si el backend es comprometido, el SDK no puede detectarlo.
**Mitigacion actual:** Ninguna. El trust model del SDK es 100% en el servidor WasiAI.

---

## NexusGuard — Hallazgos

---

### SDK-01 — MEDIUM: baseUrl no validado — riesgo SSRF en uso server-side

**Categoria:** NexusGuard | **Severidad:** MEDIUM
**Archivos:** `src/invoke.ts:23`, `src/discover.ts:34`, `src/publish.ts:24`, `src/stats.ts:26`

**Descripcion:**
El parametro `baseUrl` se acepta sin ninguna validacion en todos los modulos del SDK. Si el SDK se usa en un contexto server-side (Next.js Server Action, API Route, script Node.js) y `baseUrl` deriva de input del usuario o variables de entorno sin sanitizar, un atacante podria dirigir las peticiones del servidor a endpoints internos (SSRF).

**Vectores de riesgo:**
- En Next.js: un atacante que controle `baseUrl` podria alcanzar `http://169.254.169.254` (AWS metadata) o servicios internos.
- En scripts de CI/CD: un env var comprometido (`WASIAI_BASE_URL`) podria redirigir todos los pagos a un servidor malicioso.

**Evidencia:**
```typescript
// invoke.ts:23-24
const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
const url  = `${base}/api/v1/models/${opts.slug}/invoke`
// Sin validacion: baseUrl puede ser http://169.254.169.254/latest/meta-data/
// o cualquier URL interna del servidor que ejecuta el SDK

// Mismo patron en discover.ts:34, publish.ts:24, stats.ts:26
```

**Impacto:** MEDIUM — requiere que el atacante controle `baseUrl`, lo que implica acceso al entorno de ejecucion.

---

### SDK-02 — MEDIUM: Sin enforcement de HTTPS — API key en plaintext sobre HTTP

**Categoria:** NexusGuard | **Severidad:** MEDIUM
**Archivos:** `src/invoke.ts:29-31`, `src/publish.ts:30`, `src/stats.ts:28`, `src/langchain/WasiAITool.ts:38-40`

**Descripcion:**
El SDK envia `apiKey` en el header `X-API-Key` sin verificar que la conexion usa HTTPS. Si un desarrollador pasa un `baseUrl` con `http://` (staging, local, misconfiguracion), la API key se transmite en texto plano y puede ser interceptada por un MITM.

**Evidencia:**
```typescript
// invoke.ts:29-31
headers: {
  'Content-Type': 'application/json',
  'X-API-Key':    opts.apiKey,  // enviado sin verificar que base empiece con https://
},

// CLI: wasiai invoke --base-url http://staging.example.com --api-key wasi_xxx
// → API key en texto plano en la red
```

**Impacto:** MEDIUM — la API key comprometida permite invocar agentes a costa del usuario y acceder a sus stats de creador.

---

### SDK-03 — LOW: slug no sanitizado en URL path — path traversal potencial

**Categoria:** NexusGuard | **Severidad:** LOW
**Archivos:** `src/invoke.ts:24`, `src/langchain/WasiAITool.ts:33`

**Descripcion:**
El `slug` se interpola directamente en la URL como path segment sin ningun sanitizado. Un slug malicioso podria intentar path traversal o manipulacion de URL.

**Evidencia:**
```typescript
// invoke.ts:24
const url = `${base}/api/v1/models/${opts.slug}/invoke`
// slug = "../../../admin" → /api/v1/models/../../../admin/invoke
// slug = "agent%2F..%2F.." → depende del parsing del servidor
```

**Mitigacion actual:** Next.js (el servidor) maneja esto con seguridad via su sistema de rutas dinamicas, por lo que el riesgo real es bajo. Sin embargo, si el `baseUrl` apunta a otro servidor, la proteccion no existe.

---

### SDK-04 — LOW: WasiAITool.ts duplica DEFAULT_BASE_URL hardcodeado

**Categoria:** NexusGuard | **Severidad:** LOW
**Archivo:** `src/langchain/WasiAITool.ts:5`

**Descripcion:**
`WasiAITool.ts` define su propia constante `DEFAULT_BASE_URL = 'https://wasiai-v2.vercel.app'` en lugar de importarla de `invoke.ts`. Esto crea dos fuentes de verdad para la URL base. Si la URL del servicio cambia (custom domain, nueva instancia), `invoke.ts` se actualizaria pero `WasiAITool.ts` quedaria desfasado, dirigiendo las llamadas LangChain a la URL incorrecta.

**Evidencia:**
```typescript
// WasiAITool.ts:5 — duplicado, deberia importar
const DEFAULT_BASE_URL = 'https://wasiai-v2.vercel.app'  // ← hardcoded

// invoke.ts:8 — fuente canonica
export const DEFAULT_BASE_URL = 'https://wasiai-v2.vercel.app'
```

---

### SDK-05 — LOW: Sin limite de tamano en respuesta — riesgo de agotamiento de memoria

**Categoria:** NexusGuard | **Severidad:** LOW
**Archivos:** `src/invoke.ts:45`, `src/discover.ts:47`, `src/publish.ts:60`, `src/stats.ts:38`

**Descripcion:**
Todos los modulos del SDK llaman `res.json()` directamente sin verificar `Content-Length` ni establecer un limite de tamano de respuesta. Un servidor malicioso (o un backend WasiAI comprometido) podria devolver un body JSON de varios GB, causando agotamiento de memoria en el proceso que usa el SDK.

**Evidencia:**
```typescript
// invoke.ts:45
const data = await res.json() as Record<string, unknown>
// Sin check previo: if (res.headers.get('content-length') > MAX) throw ...
```

**Impacto:** Bajo en uso tipico (las respuestas de agentes son normalmente pequenas). MEDIUM si se usa en un entorno de produccion con muchos requests concurrentes.

---

### SDK-06 — LOW: CLI --input expone datos sensibles en logs de CI/CD

**Categoria:** NexusGuard | **Severidad:** LOW
**Archivo:** `src/cli/index.ts:43`

**Descripcion:**
El flag `--input <text>` del CLI acepta el texto de entrada como argumento de linea de comandos. Los sistemas de CI/CD (GitHub Actions, Jenkins, etc.) suelen loguear todos los argumentos del proceso. Si el usuario pasa datos sensibles como input (tokens, keys, PII), estos quedan expuestos en los logs del pipeline.

**Evidencia:**
```bash
# Esto se loguea tal cual en CI/CD:
wasiai invoke --agent my-agent --input "Bearer eyJhbGciOi..." --api-key wasi_xxx

# Los logs de CI muestran la linea completa del comando
```

**Nota:** El README no advierte sobre este riesgo. Una mitigacion simple es soportar `--input-file` o leer stdin.

---

### SDK-07 — INFO: WasiAIPaymentError referencia URL de Vercel staging

**Categoria:** NexusGuard | **Severidad:** INFO
**Archivo:** `src/langchain/errors.ts:3`

**Descripcion:**
El mensaje de error `WasiAIPaymentError` hardcodea `wasiai-v2.vercel.app` (la URL de Vercel, no un dominio custom). Si el proyecto migra a un dominio personalizado, el mensaje de error enviara a los usuarios a una URL incorrecta.

**Evidencia:**
```typescript
// errors.ts:3
super(`Payment required for agent "${slug}". Fund your API key at wasiai-v2.vercel.app`)
//                                                                    ↑ URL hardcodeada
```

---

### SDK-08 — INFO: Sin validacion de longitud de input en SDK

**Categoria:** NexusGuard | **Severidad:** INFO
**Archivos:** `src/invoke.ts:32`, `src/langchain/WasiAITool.ts:41`

**Descripcion:**
El SDK no valida la longitud del `input` antes de enviarlo. Un input muy grande (e.g., el contenido de un archivo completo) genera una request innecesariamente grande que puede causar timeouts o costos de ancho de banda. Una advertencia o limite documentado ayudaria a los desarrolladores.

---

### SDK-09 — INFO: publish endpoint_url sin validacion client-side

**Categoria:** NexusGuard | **Severidad:** INFO
**Archivo:** `src/publish.ts:38`

**Descripcion:**
`publishAgent()` envia `endpoint_url` al servidor WasiAI sin ninguna validacion client-side de formato. Un endpoint invalido (sin protocolo, URL malformada) solo falla en el servidor, generando un error generico. Validar el formato URL client-side mejoraria la DX y reduciria roundtrips innecesarios.

---

### SDK-10 — INFO: CLI stats imprime total_revenue en stdout sin advertencia

**Categoria:** NexusGuard | **Severidad:** INFO
**Archivo:** `src/cli/index.ts:269`

**Descripcion:**
El subcommand `stats` imprime ingresos totales en USDC directamente en stdout. Si el terminal esta siendo grabado, screensharido, o el output se loguea en CI, esta informacion financiera queda expuesta. No es un bug de seguridad critico pero si una consideracion de privacidad.

---

## Resumen de Hallazgos

| ID | Categoria | Severidad | Archivo(s) |
|---|---|---|---|
| SDK-01 | NexusGuard | **MEDIUM** | invoke/discover/publish/stats.ts |
| SDK-02 | NexusGuard | **MEDIUM** | invoke/publish/stats/WasiAITool.ts |
| SDK-03 | NexusGuard | LOW | invoke.ts:24, WasiAITool.ts:33 |
| SDK-04 | NexusGuard | LOW | WasiAITool.ts:5 |
| SDK-05 | NexusGuard | LOW | todos los modulos — res.json() |
| SDK-06 | NexusGuard | LOW | cli/index.ts:43 |
| SDK-07 | NexusGuard | INFO | langchain/errors.ts:3 |
| SDK-08 | NexusGuard | INFO | invoke.ts:32, WasiAITool.ts:41 |
| SDK-09 | NexusGuard | INFO | publish.ts:38 |
| SDK-10 | NexusGuard | INFO | cli/index.ts:269 |
| SDK-NA-01 | NexusAudit (adaptado) | INFO | N/A — sin codigo on-chain |

---

## Checks de Seguridad Positivos (Lo Que Esta Bien)

| Check | Archivo | Estado |
|---|---|---|
| Timeout de 30s en todas las peticiones | invoke.ts:33, WasiAITool.ts:42 | PASS |
| Errores tipados (no strings genticos) | langchain/errors.ts | PASS |
| AbortSignal.timeout() en lugar de Promise.race | invoke.ts, discover.ts, stats.ts | PASS |
| No secrets en codigo (apiKey via param, no hardcode) | todos los modulos | PASS |
| Sin `console.log` de API keys en rutas normales | todos los modulos | PASS |
| peerDependencies opcionales para LangChain | package.json:44 | PASS |
| Tests cubren error cases (402, 429, 500) | cli/index.test.ts, WasiAITool.test.ts | PASS |
| No eval(), no dynamic require() con user input | todos | PASS |
| slug como `name` de WasiAITool — no expone apiKey al orchestrator LangChain | WasiAITool.ts:28 | PASS |

---

## Score de Seguridad

| Dimension | Score | Notas |
|---|---|---|
| Input Validation | 6.0 | Sin validacion de baseUrl, slug, input length |
| Credential Handling | 7.0 | API key en params (bien), sin HTTPS enforcement (mal) |
| Error Handling | 8.5 | Errores tipados, manejo de 402/429/500 |
| Dependencies | 8.0 | Pocas deps, commander + langchain/core. Sin lockfile audit. |
| CLI Security | 6.5 | --input en args de proceso, sin --input-file |
| Supply Chain | 8.0 | No on-chain logic en SDK, trust 100% en backend |
| **Global** | **7.8** | Apropiado para SDK v0.3.0. Mejoras prioritarias: SDK-01, SDK-02 |

---

## Recomendaciones de Prioridad

1. **SDK-01 (MEDIUM)** — Validar que `baseUrl` empieza con `https://` o es la URL por defecto. Lanzar error si no.
2. **SDK-02 (MEDIUM)** — Agregar warning/error si `baseUrl` usa `http://` y se esta enviando un `apiKey`.
3. **SDK-04 (LOW)** — Eliminar `DEFAULT_BASE_URL` duplicado en `WasiAITool.ts`; importar de `invoke.ts`.
4. **SDK-03 (LOW)** — Sanitizar `slug` contra caracteres de path traversal (`/`, `..`, `%`).
5. **SDK-06 (LOW)** — Agregar soporte `--input-file <path>` como alternativa segura para CI/CD.

---

*Generado por NexusAudit v2.0 (adaptado) + NexusGuard v1.0 | WasiAI Security Framework | 2026-03-08*
