interface ErrorRow {
  status: number
  code: string
  description: string
  solution: string
}

const ERRORS: ErrorRow[] = [
  {
    status: 400,
    code: 'INVALID_PAYLOAD',
    description: 'The request body is missing required fields or has invalid JSON.',
    solution: 'Check your payload matches the agent\'s input schema.',
  },
  {
    status: 401,
    code: 'UNAUTHORIZED',
    description: 'Missing or invalid API key.',
    solution: 'Add the X-API-Key header with a valid key from your Agent Keys page.',
  },
  {
    status: 402,
    code: 'INSUFFICIENT_BALANCE',
    description: 'Your API key doesn\'t have enough balance to cover the call.',
    solution: 'Top up your key balance from the Agent Keys page.',
  },
  {
    status: 402,
    code: 'PAYMENT_REQUIRED',
    description: 'x402 payment required — the request needs a valid X-402-Payment header with ERC-3009 signature.',
    solution: 'Sign the ERC-3009 authorization and include it as X-402-Payment header. See x402 Payments docs.',
  },
  {
    status: 403,
    code: 'FORBIDDEN',
    description: 'Your API key doesn\'t have permission to invoke this agent.',
    solution: 'Check the key\'s permissions or use a key scoped to this agent.',
  },
  {
    status: 404,
    code: 'AGENT_NOT_FOUND',
    description: 'No agent found with the provided slug.',
    solution: 'Double-check the slug. Slugs are case-sensitive.',
  },
  {
    status: 429,
    code: 'RATE_LIMITED',
    description: 'You\'ve exceeded the rate limit for this key.',
    solution: 'Wait before retrying. Consider upgrading your plan for higher limits.',
  },
  {
    status: 500,
    code: 'AGENT_ERROR',
    description: 'The agent returned an error or timed out.',
    solution: 'Check the agent\'s health endpoint. The error message contains details.',
  },
  {
    status: 503,
    code: 'AGENT_UNAVAILABLE',
    description: 'The agent endpoint is down or not responding.',
    solution: 'Contact the agent creator or try again later.',
  },
  {
    status: 400,
    code: 'input_validation_failed',
    description: "The input does not match the agent's input_schema.",
    solution: 'Check the agent\'s input_schema via GET /api/v1/capabilities and fix your payload.',
  },
  {
    status: 422,
    code: 'output_schema_violation',
    description: 'The agent returned output that does not match its declared output_schema.',
    solution: 'The agent itself has a bug. Contact the creator or choose a different agent.',
  },
  {
    status: 400,
    code: 'schema_ssrf_blocked',
    description: "The agent's input_schema or output_schema contains a blocked $ref (file://, ftp://, data:, or protocol-relative //).",
    solution: 'Contact the agent creator. This schema is not safe for registration.',
  },
  {
    status: 403,
    code: 'pipeline_access_denied',
    description: 'You tried to resume a pipeline that belongs to another key.',
    solution: 'Use the same Agent Key that started the pipeline.',
  },
  {
    status: 400,
    code: 'pipeline_not_resumable',
    description: 'The pipeline cannot be resumed from the requested step.',
    solution: 'Only failed or incomplete pipelines can be resumed. Check pipeline_id status.',
  },
  {
    status: 403,
    code: 'scope_violation',
    description: 'The Agent Key does not have permission to invoke the requested agent.',
    solution: 'Check allowed_slugs or allowed_categories on this key.',
  },
  {
    status: 404,
    code: 'no_agent_match',
    description: 'No active agent matched the discovery query.',
    solution: 'Broaden your filters — try removing tag or category constraints.',
  },
]

const STATUS_COLOR: Record<number, string> = {
  400: 'bg-yellow-100 text-yellow-700',
  401: 'bg-red-100 text-red-700',
  402: 'bg-orange-100 text-orange-700',
  403: 'bg-red-100 text-red-700',
  404: 'bg-gray-100 text-gray-700',
  429: 'bg-purple-100 text-purple-700',
  500: 'bg-red-100 text-red-700',
  422: 'bg-orange-100 text-orange-700',
  503: 'bg-red-100 text-red-700',
}

export function ErrorsSection() {
  return (
    <section id="errors" className="scroll-mt-20 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Errors</h2>
        <p className="mt-2 text-gray-600">
          All errors return a JSON body with <code className="bg-gray-100 px-1 rounded text-xs">code</code> and{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">message</code> fields.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden sm:table-cell">Description</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Solution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ERRORS.map((row) => (
              <tr key={row.code} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold font-mono ${STATUS_COLOR[row.status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <code className="text-xs text-gray-800 font-mono">{row.code}</code>
                </td>
                <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{row.description}</td>
                <td className="px-4 py-3 text-gray-500 hidden md:table-cell text-xs">{row.solution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Example error response</p>
        <pre className="text-xs font-mono text-gray-600">
{`HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "code": "UNAUTHORIZED",
  "message": "Invalid or missing X-API-Key header"
}`}
        </pre>
      </div>
    </section>
  )
}
