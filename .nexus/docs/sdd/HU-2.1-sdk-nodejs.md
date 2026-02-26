---
title: SDD — HU-2.1 SDK Node.js/TypeScript @wasiai/sdk
fecha: 2026-02-26
hu_origen: HU-2.1
linear: WAS-10
HU_APPROVED: yes
SPEC_APPROVED: yes
---

## Objetivo
Publicar `@wasiai/sdk` en npm — el cliente oficial Node.js/TypeScript para que developers invoquen agentes del marketplace sin conocer el protocolo x402.

---

## Rutas / Endpoints
No se crean rutas nuevas. El SDK consume endpoints existentes:

| Método | Ruta existente | Uso |
|--------|---------------|-----|
| `GET` | `/api/v1/agents` | `sdk.list()` |
| `GET` | `/api/v1/agents/[slug]` | `sdk.get(slug)` |
| `POST` | `/api/v1/agents/[slug]/invoke` | `sdk.invoke(slug, options)` |

---

## Schema de DB
Ninguno — el SDK es un paquete externo.

## Interacciones on-chain
Ninguna directa — el SDK llama la API de WasiAI.

---

## Estructura del paquete (scope estricto)

```
packages/sdk/
├── src/
│   ├── client.ts         ← clase WasiAI (invoke, list, get)  [YA EXISTE — revisar]
│   ├── errors.ts         ← tipos de error tipados             [YA EXISTE — OK]
│   ├── types.ts          ← interfaces públicas                [YA EXISTE — OK]
│   └── index.ts          ← exports públicos                   [YA EXISTE — OK]
├── __tests__/
│   ├── client.test.ts    ← CREAR: mocks fetch, invoke/list/get + errores
│   └── errors.test.ts    ← CREAR: instanciación y mensajes
├── README.md             ← CREAR: hello world en < 10 líneas
├── tsup.config.ts        ← CREAR si no existe
├── tsconfig.json         ← CREAR si no existe
└── package.json          ← ya existe, verificar scripts
```

### Archivos fuera de scope — mover a `src/_future/`
Los siguientes archivos del sub-agente anterior NO son parte de HU-2.1:
- `src/agent.ts` → creator SDK (HU futura)
- `src/publish.ts` → publicación de agentes (HU futura)
- `src/x402.ts` + `src/x402/` → verificación pagos (HU futura)
- `src/handlers/express.ts` + `src/handlers/nextjs.ts` → (HU futura)

Acción: mover a `packages/sdk/src/_future/` con comentario `// OUT OF SCOPE — HU futura`.

---

## Correcciones al código existente

`client.ts` es sólido con un ajuste:
- `X-API-Key` en `list()` y `get()` — los endpoints GET de agents son públicos. No enviar la key en GETs públicos para no exponerla innecesariamente. Solo `invoke()` requiere la key.

---

## Flujos

### Happy Path
1. `npm install @wasiai/sdk`
2. `const sdk = new WasiAI({ apiKey: 'wasi_xxx' })`
3. `const agents = await sdk.list()`
4. `const result = await sdk.invoke('slug', { input: 'texto' })`
5. Recibe: `{ output: string, latencyMs: number, receiptId: string }`

### Edge Cases
| Caso | Comportamiento |
|------|---------------|
| `apiKey` vacío en constructor | Lanza `WasiAIError('apiKey is required')` inmediatamente |
| Agent no encontrado | `AgentNotFoundError(slug)` |
| Sin fondos en key | `InsufficientFundsError` |
| Rate limit | `RateLimitError` |
| Timeout (>30s default) | `TimeoutError` |
| API key en error.message | **NUNCA** — test explícito verifica esto |

---

## Definition of Done
- [ ] `npm run build` en `packages/sdk/` genera `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts`
- [ ] Tests unitarios pasan: `invoke`, `list`, `get`, todos los tipos de error
- [ ] Test explícito: `error.message` de cualquier error no contiene la string `wasi_` ni la API key
- [ ] `README.md` con hello world funcional en ≤ 10 líneas
- [ ] Archivos fuera de scope movidos a `src/_future/`
- [ ] `X-API-Key` solo en `invoke()`, no en GETs públicos
- [ ] `npm run build` raíz sin errores TS ni ESLint warnings (`--max-warnings 0`)

---

## Assumptions
- La org `@wasiai` en npm está disponible (confirmado: paquete 404 en registry)
- No se publica en npm en esta HU — el DoD es build + tests; publish es HU separada
- `POST /api/v1/agents/[slug]/invoke` acepta `X-API-Key` header ✅ ya verificado

## Open Questions
Ninguna.
