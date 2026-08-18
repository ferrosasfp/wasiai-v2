/**
 * GET /api/v1/status/delegation — WKH-361 W2 · AC-5, AC-6.
 *
 * Contesta, SIN que nadie tenga que pegarle a mano a `/compose` y adivinar por
 * la forma del error, qué ambiente está respondiendo y qué endpoints está
 * delegando REALMENTE hacia `wasiai-a2a`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ EXPONE, Y POR QUÉ NO ES UN SECRETO:
 *   - dos booleanos de PRESENCIA de `WASIAI_A2A_BASE_URL` y
 *     `WASIAI_V2_FORWARD_KEY`. Nunca su valor, nunca su longitud (AC-5 / CD-11);
 *   - los NOMBRES de los headers que el proxy reenvía. Nombres, jamás valores;
 *   - el conjunto de endpoints delegados;
 *   - `deploymentId`, un identificador OPACO del despliegue que atiende.
 *
 * QUÉ **NO** EXPONE, Y POR QUÉ (fix-pack AR · `MNR-4`): el `commitSha`
 * (`VERCEL_GIT_COMMIT_SHA`) estaba acá y se SACÓ. `wasiai-v2` es un repo PÚBLICO
 * con `doc/sdd/**` versionado —riesgos residuales y TD abiertos incluidos—, así
 * que publicar sin auth el commit exacto que corre `app.wasiai.io` permite cruzar
 * "qué está desplegado" con "qué se sabe que todavía no está arreglado". Ningún
 * AC lo pide: AC-5 pide *un* identificador del ambiente y AC-6 pide que dos
 * ambientes den identificadores distintos — los cubren `host` + `declaredAs` +
 * `vercelEnv` + `deploymentId`.
 *
 * `deploymentId` SÍ se queda, por tres razones medidas:
 *   (a) es lo único que distingue DOS DESPLIEGUES DEL MISMO COMMIT, que es
 *       exactamente la pregunta del cutover de esta HU ("¿ya corrió el redeploy
 *       manual de `wasiai-prod`?");
 *   (b) es la evidencia declarada de AC-6 (`sdd.md:730`);
 *   (c) es opaco: no se resuelve a código fuente sin credencial de Vercel.
 * ⚠️ Lo que NO es cierto es que "Vercel ya lo publica por su cuenta": medido el
 * 2026-08-18, lo que Vercel manda sin auth en cada respuesta es `x-vercel-id`
 * (`iad1::iad1::<traza>`), que es un id de PETICIÓN, no el `dpl_…`. Este endpoint
 * es el que lo estrena, y se decide con eso a la vista.
 *
 * Quién quiera saber si el fix de esta HU está desplegado tiene una respuesta
 * mejor que un sha en `passthroughHeaders`: ahí se lee si `x-payment-chain` está
 * en la lista blanca de ESTE despliegue. Es el hecho, no un puntero a él.
 *
 * EL `Host` LO ESCRIBE EL CALLER. Es identidad INFORMATIVA, no un borde de
 * autenticación: por eso la respuesta devuelve el host recibido AL LADO de
 * `declaredAs`, de modo que si alguien falsea el `Host` se ve en la misma
 * respuesta. Como acá no hay secretos, falsearlo no habilita nada. No agregar
 * auth a este endpoint: un endpoint de estado que requiere credencial es un
 * endpoint que nadie consulta.
 *
 * `Cache-Control: no-store` NO ES COSMÉTICO: una respuesta de estado cacheada
 * en el borde podría contestar por un despliegue que no es el que atendió —
 * que es literalmente la familia de error que abrió esta HU.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CD-4: `delegation.runtime` sale de `listDelegatedEndpoints()`, el mismo
 * símbolo que consultan las rutas, y NUNCA de releer `process.env`. Recalcular
 * la fórmula que vigilás es un guard que se aplaude a sí mismo; y además el
 * conjunto delegado se congela en carga de módulo, así que la env en vivo puede
 * decir algo que las rutas no están usando.
 */
import { NextResponse } from 'next/server'
import {
  listDelegatedEndpoints,
  isForwardKeyConfigured,
  isA2aBaseUrlConfigured,
} from '@/lib/proxy/forward-handler'
import { PASSTHROUGH_HEADERS } from '@/lib/proxy/passthrough-headers'
import {
  normalizeHost,
  resolveDeclaration,
  diffDelegation,
} from '@/lib/proxy/delegation-manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type DelegationMatch = 'MATCH' | 'DRIFT' | 'UNDECLARED_HOST'

export async function GET(req: Request): Promise<NextResponse> {
  const rawHost = req.headers.get('host')
  const host = normalizeHost(rawHost)
  const declaration = resolveDeclaration(rawHost)

  const runtimeEndpoints = [...listDelegatedEndpoints()].sort()
  const declared = declaration ? [...declaration.delegated].sort() : null

  let match: DelegationMatch
  if (declared === null) {
    match = 'UNDECLARED_HOST'
  } else {
    const diff = diffDelegation(runtimeEndpoints, declared)
    match = diff.missing.length === 0 && diff.unexpected.length === 0 ? 'MATCH' : 'DRIFT'
  }

  const body = {
    environment: {
      host,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      // `commitSha` NO va acá a propósito (fix-pack AR `MNR-4`, ver docblock).
      declaredAs: declaration?.key ?? null,
    },
    delegation: {
      runtime: runtimeEndpoints,
      declared,
      match,
    },
    config: {
      // Presencia, no valor (CD-11).
      WASIAI_A2A_BASE_URL: isA2aBaseUrlConfigured(),
      WASIAI_V2_FORWARD_KEY: isForwardKeyConfigured(),
    },
    passthroughHeaders: [...PASSTHROUGH_HEADERS],
    checkedAt: new Date().toISOString(),
  }

  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
