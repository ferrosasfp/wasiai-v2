import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        avax: {
          50:  '#fff1f1',
          100: '#ffe1e1',
          200: '#ffbdbd',
          300: '#ff8080',
          400: '#ff4d4d',
          500: '#E84142',
          600: '#d12f30',
          700: '#b02020',
          800: '#8a1a1a',
          900: '#5c1010',
        },
      },
    },
  },
  plugins: [],
}

export default config
