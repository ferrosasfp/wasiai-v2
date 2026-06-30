import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/features/**',
        'src/shared/**',
        'src/actions/**',
        // Money paths — previously excluded from coverage. Now measured so a
        // drop in settlement / billing / agent-key test coverage is visible
        // and the global thresholds below cannot be silently bypassed.
        'src/app/api/**',
        'src/lib/**',
      ],
      exclude: [
        '**/*.types.ts',
        '**/index.ts',
        '**/__tests__/**',
        '**/*.test.*',
        '**/__mocks__/**',
      ],
      // Thresholds are set just below the currently measured coverage with the
      // money paths included (stmts/lines ~21.7%, branches ~69.2%, funcs
      // ~69.9%). They act as a regression floor — raise them as coverage on the
      // api/lib money paths grows. (audit: coverage scope widened to money paths)
      thresholds: {
        lines: 20,
        functions: 65,
        branches: 65,
        statements: 20,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
