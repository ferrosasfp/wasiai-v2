import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin()

// SEC-CSP: Static CSP (no nonce). Middleware-based nonce is tracked as tech debt.
const cspDirectives = [
  "default-src 'self'",
  // Next.js requires unsafe-inline for styles and inline scripts in pages
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",
  "style-src 'self' 'unsafe-inline'",
  // Supabase, Avalanche RPCs, Sentry, WalletConnect, IPFS gateways
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.avalanche.network https://*.avax.network https://api.avax.network https://api.avax-test.network https://*.sentry.io https://*.walletconnect.com wss://*.walletconnect.com https://explorer-api.walletconnect.com https://*.mypinata.cloud https://gateway.pinata.cloud",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-src 'self' https://verify.walletconnect.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ')

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control',    value: 'on' },
  { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy',   value: cspDirectives },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    mcpServer: true,
  },
  // Fix 431 Request Header Fields Too Large
  serverExternalPackages: [],
  httpAgentOptions: {
    maxHeaderSize: 32768, // 32KB (default is 8KB)
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.mypinata.cloud' },
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: '*.ipfs.dweb.link' },
      { protocol: 'https', hostname: 'bdwvrwzvsldephfibmuu.supabase.co' },
      { protocol: 'https', hostname: 'wasiai-prod.vercel.app' },
      { protocol: 'https', hostname: 'app.wasiai.io' },
      { protocol: 'https', hostname: 'caldzjhjgctpgodldqav.supabase.co' },
    ],
  },
  async redirects() {
    return [
      // B8: /en/models (no index) → homepage marketplace
      { source: '/:locale/models', destination: '/:locale', permanent: false },
      // B8: /en/register → onboarding wizard
      { source: '/:locale/register', destination: '/:locale/onboarding', permanent: false },
    ]
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

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
})
