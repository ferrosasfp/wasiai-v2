/**
 * a2a-discover-contract.ts — la forma del body que `wasiai-a2a GET /discover`
 * devuelve, declarada del lado del CONSUMIDOR.
 *
 * ─── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────────
 * Este repo consume `/discover` desde `src/app/api/v1/capabilities/route.ts` y
 * hasta hoy no tenía escrita en ningún lado la forma de esa respuesta. Eso no
 * era neutral: dejaba que cualquiera asumiera la forma que le conviniera, y la
 * asunción cómoda (`total` es un número) dejó de ser cierta.
 *
 * ─── EL CAMBIO QUE OBLIGA A ESCRIBIRLO ──────────────────────────────────────
 * `wasiai-a2a` 9faff4f (HU-323) le agregó a `total` un TERCER ESTADO:
 *
 *     total: number | 'unknown'
 *
 * `'unknown'` cuando el catálogo llegó INCOMPLETO y por lo tanto nadie puede
 * saber el total. Antes se publicaba igual el conteo de lo que había entrado:
 * medido en producción el 2026-08-04, `/discover` devolvía `total: 23` sobre un
 * catálogo de 25 porque una fuente cortó en su página default de 20.
 *
 * Es el string `'unknown'` y NO `null` ni un campo ausente, y la razón está
 * escrita del otro lado (`wasiai-a2a/src/types/index.ts`, `ReportedTotal`): un
 * valor falsy se lee como "no hay problema". `total ?? 0` y `total || 0` darían
 * **0**, que es una afirmación MÁS falsa que el conteo recortado que se sacó.
 * `'unknown'` es truthy justamente para que no se pueda ignorar sin querer.
 *
 * ─── LAS DOS TRAMPAS, POR SI ALGUIEN LAS QUIERE ESCRIBIR ────────────────────
 *   total ?? 0        -> `'unknown' ?? 0` es `'unknown'`. No arregla nada: el
 *                        string sigue viajando y explota más lejos, donde ya no
 *                        se ve de dónde vino.
 *   Number(total)     -> `NaN`.
 *   Number(total) || 0 -> `0`, que se lee como "no hay agentes". Es la peor de
 *                        las tres: es un número plausible y es mentira.
 *
 * Si hace falta un número, el que hay que usar es {@link A2ADiscoverBody.totalAtLeast},
 * y hay que decir que es una COTA INFERIOR, no un total.
 *
 * ─── CUÁNDO SE VUELVE ALCANZABLE ────────────────────────────────────────────
 * Aguas arriba, `total` es `'unknown'` sii `catalogStatus` es `'truncated'` o
 * `'partial'` (`wasiai-a2a/src/lib/discovery-sources.ts`, `resolveReportedTotal`).
 * Son DOS disparadores distintos y no se alcanzan al mismo tiempo:
 *
 *   truncated -> una fuente declaró que hay más filas de las que trajo. Con 25
 *                agentes y un techo de 100 esto NO pasa hoy.
 *   partial   -> una fuente NO SE PUDO CONSULTAR (`state: 'failed'`: timeout,
 *                circuito abierto, SSRF bloqueado). Esto NO depende del tamaño
 *                del catálogo: pasa el día que un registry se cae, y hoy ya
 *                puede pasar.
 *
 * O sea que "todavía no llegamos al techo" cubre el primero y no el segundo.
 */

/**
 * El valor publicado de `total`. Espejo de `ReportedTotal` en
 * `wasiai-a2a/src/types/index.ts`.
 *
 * Declarado como unión a propósito: cualquier aritmética o comparación de orden
 * sobre este tipo NO COMPILA, y esa es toda su función. Un
 * `total - offset` o un `total > 0` tienen que dejar de ser escribibles sin
 * distinguir antes los dos casos.
 */
export type A2AReportedTotal = number | typeof A2A_TOTAL_UNKNOWN

/**
 * El literal exacto que manda a2a. Constante y no un string suelto para que
 * comparar contra él sea una sola cosa y un typo no compile.
 */
export const A2A_TOTAL_UNKNOWN = 'unknown'

/**
 * Roll-up de completitud de la request, tal como lo publica a2a.
 * `'complete'` significa "todas las fuentes probaron haber dado todo", no
 * "ninguna se quejó".
 */
export type A2ACatalogStatus = 'complete' | 'unverified' | 'truncated' | 'partial'

/**
 * El body de `GET /discover`, en lo que a este repo le importa.
 *
 * NO es exhaustivo y no pretende serlo: `registries`, `sources` y `excluded`
 * también viajan y este repo no los interpreta. La firma index los deja pasar
 * sin que nadie tenga que declararlos acá para que el passthrough siga siendo
 * un passthrough.
 */
export interface A2ADiscoverBody {
  agents: Array<{ slug?: unknown; id?: unknown }>
  /** Ver {@link A2AReportedTotal}. NO es siempre un número. */
  total: A2AReportedTotal
  /**
   * COTA INFERIOR del total: los matches que efectivamente se contaron.
   * SIEMPRE un número, incluso cuando `total` es `'unknown'` — es, byte por
   * byte, el valor que `total` traía antes de HU-323.
   *
   * Es el único número honesto disponible cuando `total` no lo es, y su nombre
   * ya dice que es una cota. Quien lo muestre tiene que decir "al menos N".
   */
  totalAtLeast: number
  catalogStatus?: A2ACatalogStatus
  [key: string]: unknown
}

/**
 * ─── NO HAY HELPER PARA "SACARLE EL NÚMERO A `total`" ────────────────────────
 * A propósito, y vale la pena dejarlo escrito porque la ausencia se puede leer
 * como olvido.
 *
 * 1. No haría falta: `typeof total === 'number'` ya estrecha `A2AReportedTotal`
 *    a `number` de forma nativa. Un `isKnownTotal()` sería un envoltorio de eso.
 * 2. Y sería peor: hoy NINGÚN código de producción de este repo lo llamaría
 *    (ver el §"QUÉ HACE ESTE REPO CON `total`" en `capabilities/route.ts`), así
 *    que su única cobertura vendría de tests que lo llaman para probarlo. Código
 *    cuyos únicos llamadores están en `__tests__` no está cableado a nada, y
 *    tenerlo verde da la sensación contraria.
 *
 * El día que este repo necesite un número, la forma correcta es distinguir los
 * dos casos en el punto de uso:
 *
 *     if (typeof body.total === 'number') {
 *       // hay total, la aritmética compila
 *     } else {
 *       // NO hay total. Usar `body.totalAtLeast` y decir que es una cota.
 *     }
 */

// ── Guardas de COMPILACIÓN ───────────────────────────────────────────────────
/**
 * ⚠️ POR QUÉ ESTAS GUARDAS VIVEN ACÁ Y NO EN `__tests__`.
 *
 * `tsconfig.json` EXCLUYE `src/**\/__tests__/**` y `src/**\/*.test.*`, así que
 * `npm run typecheck` no mira un solo archivo de test. Y vitest transpila sin
 * chequear tipos. Un `@ts-expect-error` escrito en un test de este repo por lo
 * tanto NO ES UNA PRUEBA DE NADA: no lo evalúa nadie, nunca se pone rojo, y sale
 * verde igual si el tipo que dice vigilar se borra. Es la clase de verde que
 * hace que se deje de mirar.
 *
 * Estas viven en un archivo que `tsc --noEmit` SÍ compila, y se exportan para
 * que no sean "variables sin usar" a ojos del lint. No tienen runtime: son
 * `type`, se borran al transpilar.
 */

/** Falla la compilación si `T` no es exactamente `true`. */
export type AssertTrue<T extends true> = T

/**
 * `total` NO es un número a secas, y por lo tanto NO es asignable a `number`.
 *
 * Las dos frases son la misma: `A2AReportedTotal extends number` ES la pregunta
 * de asignabilidad, y que dé `false` es exactamente lo que hace que
 * `total - offset`, `total > 0` y `total.toLocaleString()` sean errores de
 * compilación en vez de bugs de producción.
 *
 * Se pone ROJO si alguien "simplifica" `A2AReportedTotal` de vuelta a `number`:
 * ahí el condicional daría `false` y `AssertTrue<false>` no compila. Ésa es la
 * mutación que esta guarda existe para matar, y es la única forma de matarla en
 * este repo (ver arriba).
 */
export type AssertTotalIsNotAssignableToNumber = AssertTrue<
  A2AReportedTotal extends number ? false : true
>

/**
 * `totalAtLeast` SÍ es un número, siempre. Es la contracara de la de arriba: si
 * alguien "arregla" el problema aflojando ESTE campo a `number | 'unknown'`, el
 * repo se quedaría sin ningún número honesto y esta guarda se pone roja.
 */
export type AssertTotalAtLeastIsAlwaysANumber = AssertTrue<
  A2ADiscoverBody['totalAtLeast'] extends number ? true : false
>
