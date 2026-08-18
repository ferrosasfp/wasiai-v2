/**
 * passthrough-headers.ts — WKH-361 W0.
 *
 * La lista blanca de headers que el proxy de `wasiai-v2` reenvía hacia
 * `wasiai-a2a`, expresada como DATOS CON CRITERIO en vez de un arreglo de
 * strings. El arreglo suelto que vivía en `forward-handler.ts:39-48` no dejaba
 * lugar donde escribir POR QUÉ un header estaba en la lista, y por eso tres
 * headers que el gateway sí lee se quedaron afuera durante meses sin que nada
 * lo notara. El más caro de los tres, `x-payment-chain`, decide EN QUÉ RED se
 * cotiza y se cobra: descartarlo hacía que quien pedía Base Sepolia recibiera
 * la cotización de Kite Ozone en 18 decimales y no pudiera pagar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITERIO DE ADMISIÓN (DT-1) — un header entra si cumple LAS TRES:
 *
 *   1. TIENE UN CONSUMIDOR CITABLE EN `wasiai-a2a`, en una de tres categorías,
 *      y la cita `archivo:línea` va AL LADO del header (campo `citation`):
 *        - `read`      → hay un `headers['…']` explícito que lo lee;
 *        - `framework` → lo consume el framework de forma documentada;
 *        - `transport` → semántica de transporte obligatoria.
 *      Un header sin lector citable NO entra. La única entrada con
 *      `consumer: 'none'` / `citation: null` es `x-api-key`, alias muerto que
 *      se conserva por regresión cero (ver más abajo), y el test T-04b exige
 *      que siga siendo la única.
 *
 *   2. NO ES CREDENCIAL DE `wasiai-v2` NI IDENTIDAD DEL NAVEGADOR. Quedan
 *      afuera POR DEFINICIÓN, sin discusión caso por caso:
 *        `cookie`, `set-cookie`, `referer`, `origin`, `host`,
 *        `x-vercel-*`, `x-middleware-*`.
 *
 *   3. SU AUSENCIA ES SEMÁNTICAMENTE DISTINTA DE UN VALOR VACÍO, Y EL REENVÍO
 *      PRESERVA ESA DISTINCIÓN. Por eso la guarda `if (v)` del bucle de copia
 *      (`forward-handler.ts`) no se toca: emitir uno de estos headers con `''`
 *      convierte peticiones que hoy funcionan en 400. Medido contra
 *      `wasiai-a2a` @ 10a6eb1:
 *        - `x-a2a-contracting-depth: ''` → 400 CONTRACTING_DEPTH_MALFORMED
 *          (`wasiai-a2a/src/lib/contracting-chain.ts:822-825`)
 *        - `x-payment-chain: ''`         → 400 CHAIN_NOT_SUPPORTED
 *          (`wasiai-a2a/src/adapters/chain-resolver.ts:422`
 *           + `wasiai-a2a/src/middleware/a2a-key.ts:365-370`)
 *        - `x-a2a-contracting-chain: ''` → se absorbe como AUSENTE, no da
 *          malformed (`wasiai-a2a/src/lib/contracting-chain.ts:792-795`)
 *      La regla (nunca emitir vacío) es la misma para los tres; la razón no.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Todas las `citation` de este archivo se verificaron contra el repo
 * `wasiai-a2a` en el commit `10a6eb1` el 2026-08-18. Si una deja de coincidir,
 * el upstream se movió: hay que re-medir, no re-numerar a ojo.
 *
 * Módulo PURO a propósito: sin `server-only`, sin `@/lib/env`, sin I/O, para
 * que pueda importarse desde una ruta y testearse aislado sin arrastrar el
 * marcador server-only al grafo del test.
 */

/**
 * Categoría del consumidor del header dentro de `wasiai-a2a`.
 * `none` sólo para el alias muerto `x-api-key` (ver `PASSTHROUGH_HEADER_ENTRIES`).
 */
export type PassthroughConsumer = 'read' | 'framework' | 'transport' | 'none'

export interface PassthroughHeaderEntry {
  /** siempre en minúsculas */
  header: string
  consumer: PassthroughConsumer
  /** 'wasiai-a2a/src/…:NNN' — null SÓLO para consumer === 'none' */
  citation: string | null
  /** una línea, en castellano */
  why: string
}

/**
 * Las 11 entradas. Las 8 históricas conservan su orden original; las 3 nuevas
 * de WKH-361 van al final. El orden es parte del contrato que fija T-04.
 */
export const PASSTHROUGH_HEADER_ENTRIES: readonly PassthroughHeaderEntry[] = [
  {
    header: 'x-payment',
    consumer: 'read',
    citation: 'wasiai-a2a/src/middleware/x402.ts:517',
    why: 'el challenge x402 canónico; sin él no hay pago',
  },
  {
    header: 'payment-signature',
    consumer: 'read',
    citation: 'wasiai-a2a/src/middleware/x402.ts:518',
    why: 'forma legacy del mismo pago (`x-payment` gana)',
  },
  {
    header: 'x-a2a-key',
    consumer: 'read',
    citation: 'wasiai-a2a/src/middleware/a2a-key.ts:546',
    why: 'credencial de agent key prepaga',
  },
  {
    header: 'x-api-key',
    consumer: 'none',
    citation: null,
    why:
      'alias muerto: en todo `wasiai-a2a/src/` aparece UNA vez y es un fixture ' +
      '(`src/services/registry.redaction.test.ts:319`). Medido 2026-08-18. Se conserva ' +
      'por regresión cero — las dos pantallas que lo mandan migran en A-5, no acá (CD-12)',
  },
  {
    header: 'authorization',
    consumer: 'read',
    citation: 'wasiai-a2a/src/middleware/a2a-key.ts:551',
    why: '`Bearer` con prefijo `wasi_a2a_` (`wasiai-a2a/src/middleware/a2a-key.ts:554`)',
  },
  {
    header: 'content-type',
    consumer: 'transport',
    citation: 'wasiai-a2a/src/routes/compose.ts:326',
    why: 'el parser de Fastify puebla `request.body` sólo si el content-type matchea',
  },
  {
    header: 'user-agent',
    consumer: 'framework',
    citation: 'wasiai-a2a/src/lib/logger.test.ts:43',
    why: 'sobrevive `REDACT_PATHS` (`wasiai-a2a/src/index.ts:156`): es el log de request',
  },
  {
    header: 'x-forwarded-for',
    consumer: 'framework',
    citation: 'wasiai-a2a/src/index.ts:163',
    why: '`trustProxy` resuelve `request.ip` desde acá (`wasiai-a2a/src/index.ts:158`)',
  },
  {
    header: 'x-a2a-contracting-chain',
    consumer: 'read',
    citation: 'wasiai-a2a/src/lib/contracting-chain.ts:769',
    why: 'capa 2 del guard anti-bucle de WKH-360 (paso 3 en `contracting-chain.ts:806-818`)',
  },
  {
    header: 'x-a2a-contracting-depth',
    consumer: 'read',
    citation: 'wasiai-a2a/src/lib/contracting-chain.ts:820',
    why: 'techo de profundidad (paso 4, `contracting-chain.ts:820-827`)',
  },
  {
    header: 'x-payment-chain',
    consumer: 'read',
    citation: 'wasiai-a2a/src/middleware/a2a-key.ts:358',
    why:
      'en qué red se cotiza y se cobra; también `wasiai-a2a/src/middleware/x402.ts:425`, ' +
      '`src/routes/compose.ts:107`, `src/routes/gasless.ts:77`',
  },
]

/**
 * Los nombres, en el mismo orden que `PASSTHROUGH_HEADER_ENTRIES`.
 * Es lo que consume el bucle de copia de `forward-handler.ts` y lo que publica
 * `GET /api/v1/status/delegation` (NOMBRES, jamás valores).
 */
export const PASSTHROUGH_HEADERS: readonly string[] = PASSTHROUGH_HEADER_ENTRIES.map(
  (e) => e.header,
)

// ─────────────────────────────────────────────────────────────────────────────
// RADIO DE IMPACTO — fix-pack AR · `BLQ-MED-1`
//
// Admitir un header no es sólo "ahora pasa": es HABILITAR TODOS LOS RECHAZOS que
// ese header puede provocar en el gateway. Peticiones que hoy funcionan (porque
// el proxy descarta el header y se aplica el default) pasan a cortar en 400/403.
//
// El AR encontró que el radio declarado eran 3 filas y el disparador de reversa
// vigilaba 2 códigos, cuando las familias nuevas son SEIS. La causa no fue
// descuido: era prosa en un `.md`, y la prosa no falla cuando se agrega un
// header. Por eso el radio vive acá, al lado de la lista blanca, con un test que
// exige que CADA header nuevo declare qué rechazos habilita y CÓMO SE VE cada
// uno desde el punto de observación de la reversa.
//
// ⚠️ ESTO NO ES UNA COPIA DEL CÓDIGO DEL GATEWAY: es lo medido el 2026-08-18
// contra `https://wasiai-a2a-production.up.railway.app/compose` con body
// `{"steps":[{"agent":"wasi-chainlink-price"}]}`. Las 6 filas se reprodujeron una
// por una; `app.wasiai.io` devolvió `402` (el default) en las 6.
// ─────────────────────────────────────────────────────────────────────────────

export interface RejectionFamily {
  /** `error_code` que devuelve `wasiai-a2a`. */
  code: string
  /** Status HTTP medido. */
  status: number
  /** Cuál de los headers de la lista blanca lo habilita. */
  header: string
  /** Valor con el que se reproduce. */
  trigger: string
  /**
   * Cómo se ve en los logs de Railway del gateway (A-4, el punto de observación
   * declarado del disparador de reversa). `null` ⇒ NO tiene línea propia y sólo
   * se ve como un `400` anónimo: ese caso OBLIGA a llenar `blindSpot`.
   */
  railwayLogLine: string | null
  /** Por qué no se puede vigilar directo, y con qué se suple. */
  blindSpot: string | null
  /** `archivo:línea` del emisor en `wasiai-a2a` @ `10a6eb1`. */
  citation: string
}

export const REJECTION_FAMILIES: readonly RejectionFamily[] = [
  {
    code: 'CHAIN_NOT_SUPPORTED',
    status: 400,
    header: 'x-payment-chain',
    trigger: "un slug de red que el gateway no conoce (p. ej. 'nonexistent-chain-xyz'), o vacío",
    railwayLogLine: null,
    blindSpot:
      'el emisor NO loguea: `reply.status(400).send(...)` sin `request.log`. Y ninguno de los dos ' +
      'ganchos globales lo suple: el `setErrorHandler` (`error-boundary.ts:72`) sólo atrapa ' +
      'excepciones LANZADAS, y esto es un `reply.send` normal; el `onResponse` de ' +
      '`event-tracking.ts:111-141` sí cubre `/compose` pero graba `statusCode` + `requestId`, ' +
      'NUNCA el `error_code`. En Railway se ve un 400 sin código. Se identifica cruzando por ' +
      '`reqId` con la línea `forward-key source` (`{forwardSource:"v2-proxy"}`) y descartando ' +
      'los 400 que sí traen `contracting-guard.rejected`. Cerrarlo de verdad = agregar un log ' +
      'en `wasiai-a2a` ⇒ CD-5 lo prohíbe en esta HU ⇒ acción declarada, no ejecutada.',
    citation: 'wasiai-a2a/src/middleware/a2a-key.ts:366-370',
  },
  {
    code: 'INSUFFICIENT_BUDGET',
    status: 403,
    header: 'x-payment-chain',
    trigger: 'una red en la que la agent key del caller no tiene saldo',
    railwayLogLine: "log.warn 'a2a-key.insufficient-budget' con {keyId, chainKey, defaultApplied}",
    blindSpot: null,
    citation: 'wasiai-a2a/src/middleware/a2a-key.ts:1264-1275',
  },
  {
    code: 'CONTRACTING_DEPTH_EXCEEDED',
    status: 400,
    header: 'x-a2a-contracting-depth',
    trigger:
      "depth >= depthMax. El card vivo declara depthMax: 2, así que '2' —un valor normal para " +
      "un intermediario de segundo nivel— pasa de funcionar a 400. Medido: '1' ⇒ 402, '2' ⇒ 400",
    railwayLogLine: "log.warn 'contracting-guard.rejected' con {code, layer:'depth', depthMax}",
    blindSpot: null,
    citation: 'wasiai-a2a/src/lib/contracting-chain.ts:837-838',
  },
  {
    code: 'CONTRACTING_DEPTH_MALFORMED',
    status: 400,
    header: 'x-a2a-contracting-depth',
    trigger: "cualquier valor que no sea un entero decimal de 1 a 3 dígitos (p. ej. 'abc')",
    railwayLogLine: "log.warn 'contracting-guard.rejected' con {code, layer:'depth'}",
    blindSpot: null,
    citation: 'wasiai-a2a/src/lib/contracting-chain.ts:823-824',
  },
  {
    code: 'CONTRACTING_CHAIN_MALFORMED',
    status: 400,
    header: 'x-a2a-contracting-chain',
    trigger: "un valor que no es CSV de hostnames pelados (p. ej. 'no es un host!!')",
    railwayLogLine:
      "log.warn 'contracting-guard.rejected' con {code, layer:'chain', chainHeaderChars}",
    blindSpot: null,
    citation: 'wasiai-a2a/src/lib/contracting-chain.ts:810-816',
  },
  {
    code: 'CONTRACTING_LOOP_DETECTED',
    status: 400,
    header: 'x-a2a-contracting-chain',
    trigger: 'que el propio host del gateway figure en la cadena',
    railwayLogLine: "log.warn 'contracting-guard.rejected' con {code, layer:'chain'}",
    blindSpot: null,
    citation: 'wasiai-a2a/src/lib/contracting-chain.ts:830-832',
  },
]

/**
 * Los códigos que el disparador de reversa tiene que vigilar en la ventana de 60
 * minutos posterior a la promoción de `wasiai-prod` (`story-file.md` §13).
 * Se DERIVA de `REJECTION_FAMILIES` en vez de escribirse a mano: una lista a mano
 * es lo que quedó corta la primera vez.
 */
export const REVERSAL_WATCHLIST: readonly string[] = REJECTION_FAMILIES.map((f) => f.code)

/**
 * Los tres headers que WKH-361 agrega a la lista blanca — o sea, los únicos cuyo
 * radio de impacto es NUEVO. Los otros 8 ya se reenviaban desde WKH-66.
 */
export const WKH_361_NEW_HEADERS: readonly string[] = [
  'x-a2a-contracting-chain',
  'x-a2a-contracting-depth',
  'x-payment-chain',
]
