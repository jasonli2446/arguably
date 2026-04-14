import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.{ts,tsx}'],
    exclude: ['tests/**', 'node_modules/**', '__tests__/sfu/**', '__tests__/realtime/**', '__tests__/security/auth.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
