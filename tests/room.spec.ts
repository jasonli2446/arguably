import { test, expect } from '@playwright/test'

test.describe('Room Page', () => {
  test('redirects unauthenticated users to auth for invalid room code', async ({ page }) => {
    await page.goto('/room/INVALID-CODE')
    // Middleware redirects unauthenticated users to /auth
    await expect(page).toHaveURL(/\/auth/)
    await expect(page.getByText('SIGN IN')).toBeVisible()
  })

  test('redirects unauthenticated users to auth for any room', async ({ page }) => {
    await page.goto('/room/ARG-0000')
    // Unauthenticated users are redirected to auth
    await expect(page).toHaveURL(/\/auth/)
    await expect(page.getByText('SIGN IN')).toBeVisible()
  })
})
