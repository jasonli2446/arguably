import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/sfu/**/*.test.ts', '__tests__/realtime/**/*.test.ts', '__tests__/security/auth.test.ts'],
    testTimeout: 30000,
    server: {
      deps: {
        inline: ['jose'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
