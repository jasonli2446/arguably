import { test, expect } from '@playwright/test'

test.describe('Room Page (Unauthenticated)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('redirects unauthenticated users to auth for invalid room code', async ({ page }) => {
    await page.goto('/room/INVALID-CODE')
    await expect(page).toHaveURL(/\/auth/)
    await expect(page.getByText('SIGN IN')).toBeVisible()
  })

  test('redirects unauthenticated users to auth for any room', async ({ page }) => {
    await page.goto('/room/ARG-0000')
    await expect(page).toHaveURL(/\/auth/)
    await expect(page.getByText('SIGN IN')).toBeVisible()
  })
})

test.describe('Room Page (Authenticated)', () => {
  test('room page shows correct structure after creation', async ({ page }) => {
    // Create a room to ensure one exists
    await page.goto('/create')
    await page.getByPlaceholder('Enter debate topic...').fill('Room Structure Test')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // Verify key UI elements
    await expect(page.getByText('MODERATOR')).toBeVisible()
    await expect(page.getByText(/AUDIENCE \(/)).toBeVisible()
    await expect(page.getByText(/PARTICIPANTS \(/)).toBeVisible()
    await expect(page.getByText('LIVE TRANSCRIPT')).toBeVisible()
    await expect(page.getByText('EXIT ROOM')).toBeVisible()
    await expect(page.getByText(/ARG-\d{4}/)).toBeVisible()
  })

  test('shows not found for non-existent room code', async ({ page }) => {
    await page.goto('/room/ARG-9999')
    // Authenticated user hits notFound() for invalid code
    const content = await page.textContent('body')
    expect(content).toMatch(/404|not found|could not be found/i)
  })
})
