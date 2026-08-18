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
