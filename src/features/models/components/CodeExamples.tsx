// Server Component — ISR compatible, no 'use client'
import { getTranslations } from 'next-intl/server'
import { CodeExamplesTabs } from './CodeExamplesTabs'

const SITE_URL = (
  process.env.SITE_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  'https://app.wasiai.io'
).replace(/\/$/, '')

interface Props {
  slug: string
  priceUsdc?: string | null
  inputExample?: string | null
  locale: string
}

function generateSnippets(
  slug: string,
  priceUsdc: string | null | undefined,
  inputExample: string,
  invokeBaseUrl: string
): { curl: string; node: string; python: string } {
  const isFree = !priceUsdc || priceUsdc === '0'
  const freeNoteHash = isFree ? ' # free agent' : ''
  const freeNoteSlash = isFree ? ' // free agent' : ''
  // Sanitizar inputExample para evitar ruptura de template strings
  const safeInput = JSON.stringify(inputExample) // incluye comillas: "Hello, world!"
  // MAJOR-2: Sanitizar slug para evitar inyección en template literals
  const safeSlug = slug.replace(/[^a-z0-9\-_]/gi, '')
  const invokeUrl = `${invokeBaseUrl}/api/v1/models/${safeSlug}/invoke`

  const curl =
`curl -X POST ${invokeUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wasi_YOUR_KEY" \\
  -d '{"input": ${safeInput}}'${freeNoteHash}`

  const node =
`const response = await fetch(
  '${invokeUrl}',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'wasi_YOUR_KEY',
    },
    body: JSON.stringify({ input: ${safeInput} }),
  }
)
const { output } = await response.json()
console.log(output)${freeNoteSlash ? '\n' + freeNoteSlash : ''}`

  const python =
`import requests

response = requests.post(
  '${invokeUrl}',
  headers={
    'Content-Type': 'application/json',
    'X-API-Key': 'wasi_YOUR_KEY',
  },
  json={'input': ${safeInput}}
)
print(response.json()['output'])${freeNoteHash}`

  return { curl, node, python }
}

export async function CodeExamples({ slug, priceUsdc, inputExample, locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'codeExamples' })
  const example = inputExample ?? 'Hello, world!'
  const snippets = generateSnippets(slug, priceUsdc, example, SITE_URL)
  const keysUrl = `/${locale}/agent-keys`

  return (
    <div className="rounded-2xl bg-gray-900 overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          {t('title')}
        </h2>
      </div>
      <CodeExamplesTabs
        snippets={snippets}
        keysUrl={keysUrl}
        labels={{
          copy: t('copy'),
          copied: t('copied'),
          replace: t('replace'),
          getKey: t('getKey'),
        }}
      />
    </div>
  )
}
