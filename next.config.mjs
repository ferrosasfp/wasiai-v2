import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control',    value: 'on' },
  { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval needed for Next.js dev
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co https://api.avax.network https://api.avax-test.network https://api.pimlico.io https://facilitator.ultravioletadao.xyz wss://*.supabase.co",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    mcpServer: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.mypinata.cloud' },
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: '*.ipfs.dweb.link' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default withNextIntl(nextConfig)
