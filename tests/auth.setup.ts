import { test as setup, expect } from '@playwright/test'
import path from 'path'

const authFile = path.join(__dirname, '..', '.playwright', '.auth', 'user.json')

setup('authenticate', async ({ page }) => {
  await page.goto('/auth')
  await page.getByPlaceholder('you@example.com').fill(process.env.TEST_USER_EMAIL!)
  await page.getByPlaceholder('Min 6 characters').fill(process.env.TEST_USER_PASSWORD!)
  await page.getByRole('button', { name: 'ENTER ARENA' }).click()

  // Wait for successful login — should redirect to /browse
  await expect(page).toHaveURL('/browse', { timeout: 15000 })

  // Save signed-in state
  await page.context().storageState({ path: authFile })
})
