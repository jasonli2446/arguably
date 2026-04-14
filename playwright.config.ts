import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const authFile = path.join(__dirname, '.playwright', '.auth', 'user.json')

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    // Auth setup — logs in and saves storageState
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // Public pages — no auth needed
    {
      name: 'public',
      testMatch: /\/(auth|browse)\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Authenticated pages — depends on setup
    {
      name: 'authenticated',
      testIgnore: /\/(auth|browse)\.spec\.ts$/,
      testMatch: /\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
