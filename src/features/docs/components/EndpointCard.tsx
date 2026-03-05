import { useTranslations } from 'next-intl'

interface Param {
  name: string
  type: string
  required?: boolean
  description: string
}

interface EndpointCardProps {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  description: string
  auth?: boolean
  params?: Param[]
  bodyParams?: Param[]
  responseExample?: string
}

const METHOD_COLORS: Record<string, string> = {
  GET:    'bg-blue-100 text-blue-700',
  POST:   'bg-green-100 text-green-700',
  PUT:    'bg-yellow-100 text-yellow-700',
  DELETE: 'bg-red-100 text-red-700',
  PATCH:  'bg-purple-100 text-purple-700',
}

export function EndpointCard({
  method,
  path,
  description,
  auth = true,
  params = [],
  bodyParams = [],
  responseExample,
}: EndpointCardProps) {
  const t = useTranslations('endpointCard')
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden mb-6">
      {/* Header */}
      <div className="flex items-center gap-3 bg-gray-50 px-4 py-3 border-b border-gray-200">
        <span className={`rounded px-2 py-0.5 text-xs font-bold font-mono ${METHOD_COLORS[method]}`}>
          {method}
        </span>
        <code className="text-sm font-mono text-gray-800">{path}</code>
        {auth && (
          <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
            Auth required
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-600">{description}</p>

        {/* Path params */}
        {params.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('pathParams')}</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="pb-1 pr-4">{t('name')}</th>
                  <th className="pb-1 pr-4">{t('type')}</th>
                  <th className="pb-1">{t('description')}</th>
                </tr>
              </thead>
              <tbody>
                {params.map((p) => (
                  <tr key={p.name} className="border-t border-gray-100">
                    <td className="py-1.5 pr-4 font-mono text-gray-800">
                      {p.name}
                      {p.required && <span className="text-red-500 ml-1">*</span>}
                    </td>
                    <td className="py-1.5 pr-4 text-gray-500">{p.type}</td>
                    <td className="py-1.5 text-gray-600">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Body params */}
        {bodyParams.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('bodyParams')}</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="pb-1 pr-4">{t('name')}</th>
                  <th className="pb-1 pr-4">{t('type')}</th>
                  <th className="pb-1">{t('description')}</th>
                </tr>
              </thead>
              <tbody>
                {bodyParams.map((p) => (
                  <tr key={p.name} className="border-t border-gray-100">
                    <td className="py-1.5 pr-4 font-mono text-gray-800">
                      {p.name}
                      {p.required && <span className="text-red-500 ml-1">*</span>}
                    </td>
                    <td className="py-1.5 pr-4 text-gray-500">{p.type}</td>
                    <td className="py-1.5 text-gray-600">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Response example */}
        {responseExample && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('exampleResponse')}</p>
            <pre className="rounded-lg bg-[#0d1117] p-3 text-xs text-green-400 font-mono overflow-x-auto">
              {responseExample}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
