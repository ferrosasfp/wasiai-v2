import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand ramp — Solana purple, mirrored from the landing's accent tokens.
        // 300/400 are the landing's dark-theme accents, 700/900 its light-theme ones,
        // and 500 is Solana's own brand purple.
        avax: {
          50:  '#f5f0ff',
          100: '#ede0ff',
          200: '#dcc4ff',
          300: '#c79bff',
          400: '#a96bff',
          500: '#9945FF',
          600: '#7c2ff0',
          700: '#6d28d9',
          800: '#571fae',
          900: '#3b0f73',
        },
      },
    },
  },
  plugins: [],
}

export default config
