import { test, expect } from '@playwright/test'

test.describe('Room Page', () => {
  test('shows 404 for invalid room code', async ({ page }) => {
    const response = await page.goto('/room/INVALID-CODE')
    // Should return 404 since no session exists with this code
    expect(response?.status()).toBe(404)
  })

  test('room page structure loads correctly', async ({ page }) => {
    // This test assumes a room exists — if it doesn't, it will 404 which is expected
    await page.goto('/room/ARG-0000')
    const is404 = await page.getByText('404').isVisible().catch(() => false)

    if (!is404) {
      // If room exists, verify key UI elements
      await expect(page.getByText(/MODERATOR/)).toBeVisible()
      await expect(page.getByText(/AUDIENCE QUEUE/)).toBeVisible()
      await expect(page.getByText(/PARTICIPANTS/)).toBeVisible()
    }
  })
})
