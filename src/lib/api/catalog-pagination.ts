/**
 * catalog-pagination.ts — paginación del catálogo público (`GET /api/v1/capabilities`).
 *
 * ─── QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO ────────────────────────────────────
 * Medido contra `https://app.wasiai.io/api/v1/capabilities` el 2026-08-04:
 *
 *   sin parámetros   -> 200, 23 agentes, `total: 23`
 *   ?limit=5         -> 200,  5 agentes, `total: 25`   <- el total sube
 *   ?limit=100       -> 200, 25 agentes, `total: 25`
 *   ?limit=1000      -> 200, 25 agentes, `total: 25`
 *   ?limit=0 / -3 / abc -> 400 INVALID_LIMIT (lo tira el gateway a2a)
 *   ?offset=5 / ?page=2 / ?cursor=abc -> 400 UNKNOWN_DISCOVER_PARAM
 *
 * O sea que el catálogo entero SÍ era alcanzable en una llamada (`limit` grande),
 * y `total` ya avisaba que había más. Lo que NO existía es una forma de pedir
 * "la página siguiente": `limit` es un top-N, no una ventana.
 *
 * ─── EL HALLAZGO QUE DECIDE EL DISEÑO ───────────────────────────────────────
 * El orden de `agents` NO es reproducible entre requests. Cuatro llamadas
 * seguidas a `?limit=100` devolvieron el MISMO conjunto de 25 slugs en CUATRO
 * ÓRDENES DISTINTOS. No es un empate mal desempatado: aguas arriba el desempate
 * es literalmente `Math.random()`, asignado una vez por agente y por request
 * (wasiai-a2a `src/lib/ranking-tiebreak.ts`, HU-208 — deliberado, para no
 * repartir ingresos por el orden de un `concat`). El comparador de a2a es
 * `verified desc -> reputación desc -> precio asc -> aleatorio`.
 *
 * Ese orden es total y estable DENTRO de una request, y no lo es ENTRE
 * requests. Consecuencia dura, y es la razón de todo lo que sigue:
 *
 *   Ni offset ni cursor pueden apoyarse en el orden de aguas arriba.
 *   Pedir `[0,10)` y después `[10,20)` son dos barajadas distintas: el resultado
 *   tiene repetidos y faltantes aunque el catálogo no haya cambiado.
 *
 * Por eso la paginación NO se delega: se resuelve acá, imponiendo un orden total
 * y determinístico propio — `(slug, id)` ascendente — sobre el conjunto COMPLETO
 * traído en UNA sola llamada upstream.
 *
 * ─── POR QUÉ offset Y NO cursor ─────────────────────────────────────────────
 * 1. Un cursor necesita que la fuente honre un "empezá después de X". El gateway
 *    a2a rechaza con 400 toda clave que no esté en su allowlist (`offset`,
 *    `page` y `cursor` fueron los tres medidos arriba), así que un cursor no se
 *    puede empujar aguas arriba: se resolvería igual acá, en memoria. Sería un
 *    offset con un base64 encima — un token opaco cuyo único contenido es un
 *    número. Eso ya se publicó una vez sin existir (commit ceddfca83); no se
 *    repite.
 * 2. La ventaja real del cursor (estabilidad frente a inserciones concurrentes)
 *    no se puede cobrar acá: cada página re-trae el conjunto entero de todos
 *    modos, así que una inserción entre página y página se ve igual con las dos
 *    técnicas. Lo que sí se gana es lo que arregla el orden `(slug, id)`, y eso
 *    es independiente de la técnica.
 * 3. 25 filas, y el techo de fetch de aguas arriba es 200 por registry: el costo
 *    de re-traer todo por página es el mismo request que ya se hacía.
 *
 * ─── LÍMITE QUE ESTE MÓDULO **NO** RESUELVE ─────────────────────────────────
 * Se pagina sobre lo que UNA llamada upstream devuelve. Si aguas arriba recorta
 * (su fetch por registry se clampea al `maxLimit` declarado — el registry
 * `WasiAI` declara 100), el conjunto paginado es el recortado, no el catálogo.
 * Cerrarlo de verdad exige paginación en a2a (otro repo).
 *
 * ⚠️ ACÁ DECÍA que el cliente se entera comparando `offset + agents.length` con
 * `total`, "el denominador PRE-límite de a2a". Esa receta ES EL BUG QUE ESTA
 * NOTA TENÍA: `wasiai-a2a` 9faff4f (HU-323) hizo que `total` sea
 * `number | 'unknown'`, y vale `'unknown'` EXACTAMENTE en el caso que la receta
 * quería detectar (catálogo incompleto). O sea que la comparación se rompía
 * justo cuando había que hacerla, y encima en silencio: `offset + n < 'unknown'`
 * no tira, devuelve `false`, que se lee como "te entregué todo".
 *
 * Las dos señales que SÍ sirven, y las dos viajan en el body sin que este módulo
 * las toque (ver `a2a-discover-contract.ts`):
 *   catalogStatus !== 'complete'            -> el catálogo llegó incompleto.
 *   offset + agents.length < totalAtLeast   -> `totalAtLeast` es SIEMPRE un
 *                                              número, y es una COTA INFERIOR:
 *                                              "hay al menos esto", no "hay
 *                                              esto".
 */

/**
 * Tope de tamaño de página. EXPLÍCITO y exportado a propósito: es contrato
 * público (un `limit` mayor da 400, no un recorte mudo) y los tests negativos
 * leen esta constante en vez de copiar el número.
 *
 * 100 no es arbitrario: es el mismo techo que ya aplicaba el handler legacy de
 * este endpoint (`limit must be between 1 and 100`) y el `maxLimit` con el que
 * el registry `WasiAI` está declarado en a2a. Subirlo acá sin subirlo allá
 * prometería páginas que el fetch upstream no puede llenar.
 */
export const MAX_PAGE_SIZE = 100

/**
 * Tamaño de página cuando el caller pide `offset` sin `limit`.
 * 20 es el default histórico del handler legacy de este mismo endpoint.
 */
export const DEFAULT_PAGE_SIZE = 20

/**
 * Cuántas filas se le piden a a2a en la llamada que alimenta UNA página.
 *
 * NO es el tamaño de página y no puede serlo: `limit` aguas arriba es un top-N
 * del ranking barajado, así que pedir `offset + limit` daría el top-N de UNA
 * barajada y la ventana `[offset, offset+limit)` del orden `(slug, id)` no
 * estaría contenida ahí. Para que el orden propio sea correcto hay que ordenar
 * el conjunto COMPLETO, así que se pide de una vez mucho más de lo que se sirve.
 *
 * 500 > (25 agentes reales) y > (100, el `maxLimit` declarado del registry), y
 * está por debajo del `Number.isSafeInteger` que exige a2a. Medido: `?limit=1000`
 * ya devolvía las 25 filas sin error, así que el número no es frágil.
 */
export const CATALOG_FETCH_LIMIT = 500

/** Nombre del parámetro que ACTIVA el modo paginado. */
export const PAGINATION_OFFSET_PARAM = 'offset'

/** Nombre del parámetro de tamaño de página. */
export const PAGINATION_LIMIT_PARAM = 'limit'

export interface PageRequest {
  offset: number
  limit: number
}

export type ParsePageRequestResult =
  | { ok: true; value: PageRequest }
  | { ok: false; code: string; message: string }

/**
 * Un parámetro PRESENTE pero vacío es un error, no un ausente.
 *
 * `Number('')` y `Number('  ')` valen `0`, así que sin este chequeo
 * `?offset=` pasaría como `offset: 0` y paginaría una request que nunca eligió
 * un offset. Es la misma clase de silencio que este módulo existe para cerrar.
 */
function isBlank(raw: string): boolean {
  return raw.trim() === ''
}

/**
 * Lee y valida `offset` / `limit`. Sólo se llama cuando `offset` está presente
 * (el modo paginado es OPT-IN — ver el comentario del route).
 *
 * Reglas, y las cuatro formas de `limit` inválido están cubiertas:
 *   offset : entero seguro >= 0. Ausente no llega acá. Vacío, no numérico,
 *            fraccionario o negativo -> 400 INVALID_OFFSET.
 *   limit  : ausente -> DEFAULT_PAGE_SIZE. Presente -> entero seguro en
 *            [1, MAX_PAGE_SIZE]. `0`, negativo, no numérico (`NaN`),
 *            fraccionario, `1e21` (no es safe integer) y `> MAX_PAGE_SIZE`
 *            -> 400 INVALID_LIMIT.
 *
 * Nunca devuelve "todo" ante un valor inválido, y nunca lanza: el caller mapea
 * `ok: false` a un 400. Un `limit` basura que devuelve el catálogo entero es el
 * bug que a2a ya tuvo documentado (`discovery-query.ts`, `InvalidLimitError`).
 */
export function parsePageRequest(
  searchParams: URLSearchParams,
): ParsePageRequestResult {
  const rawOffset = searchParams.get(PAGINATION_OFFSET_PARAM)
  if (rawOffset === null || isBlank(rawOffset)) {
    return {
      ok: false,
      code: 'INVALID_OFFSET',
      message: `${PAGINATION_OFFSET_PARAM} must be an integer >= 0`,
    }
  }
  const offset = Number(rawOffset)
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return {
      ok: false,
      code: 'INVALID_OFFSET',
      message: `${PAGINATION_OFFSET_PARAM} must be an integer >= 0`,
    }
  }

  const rawLimit = searchParams.get(PAGINATION_LIMIT_PARAM)
  if (rawLimit === null) {
    return { ok: true, value: { offset, limit: DEFAULT_PAGE_SIZE } }
  }
  const limit = Number(rawLimit)
  if (
    isBlank(rawLimit) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE
  ) {
    return {
      ok: false,
      code: 'INVALID_LIMIT',
      message: `${PAGINATION_LIMIT_PARAM} must be an integer between 1 and ${MAX_PAGE_SIZE}`,
    }
  }
  return { ok: true, value: { offset, limit } }
}

/** Lo mínimo que este módulo necesita saber de un agente para ordenarlo. */
export interface OrderableAgent {
  slug?: unknown
  id?: unknown
}

/** Clave de orden como string; un campo ausente ordena antes que cualquier valor. */
function orderKey(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/**
 * Orden total y determinístico: `slug` ascendente, `id` ascendente para
 * desempatar.
 *
 * El par, y no sólo `slug`: dos registries distintos pueden publicar el mismo
 * slug, y ahí el orden volvería a depender del arreglo. Con `id` el orden queda
 * total mientras el par sea único, que es lo mismo que decir "mientras dos filas
 * no sean la misma fila".
 *
 * Comparación por unidad de código (`<` / `>`), NO `localeCompare`: el collation
 * de ICU depende del locale y de la versión del runtime, así que dos instancias
 * podrían ordenar distinto y la página 2 dejaría de ser la continuación de la 1.
 * Cambiar un orden aleatorio por uno dependiente del entorno no arregla nada.
 */
export function compareForPaging(a: OrderableAgent, b: OrderableAgent): number {
  const slugA = orderKey(a.slug)
  const slugB = orderKey(b.slug)
  if (slugA !== slugB) return slugA < slugB ? -1 : 1
  const idA = orderKey(a.id)
  const idB = orderKey(b.id)
  if (idA !== idB) return idA < idB ? -1 : 1
  return 0
}

export interface CatalogPage<T> {
  page: T[]
  hasMore: boolean
  nextOffset: number | null
}

/**
 * Ordena el conjunto completo y devuelve la ventana `[offset, offset + limit)`.
 *
 * No muta la entrada (`[...agents]`): el caller sigue usando el body upstream
 * para el resto de los campos.
 *
 * `hasMore` se calcula contra el conjunto que REALMENTE se recibió, no contra el
 * `total` que declara a2a. Los dos pueden diferir (ver "LÍMITE QUE ESTE MÓDULO
 * NO RESUELVE" arriba) y afirmar `has_more: true` sobre filas que no se pueden
 * servir mandaría al cliente a un bucle infinito pidiendo páginas vacías.
 *
 * Un `offset` más allá del final devuelve una página vacía con
 * `hasMore: false` — es una página válida, no un error: quien recorre de a N y
 * el catálogo mide múltiplo exacto de N cae ahí en su última llamada.
 */
export function paginateCatalog<T extends OrderableAgent>(
  agents: T[],
  { offset, limit }: PageRequest,
): CatalogPage<T> {
  const ordered = [...agents].sort(compareForPaging)
  const page = ordered.slice(offset, offset + limit)
  const hasMore = offset + page.length < ordered.length
  return { page, hasMore, nextOffset: hasMore ? offset + page.length : null }
}
