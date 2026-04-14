import { test, expect } from '@playwright/test'

test.describe('Leave Session', () => {
  test('EXIT ROOM button returns to browse page', async ({ page }) => {
    // Create a room first
    await page.goto('/create')
    await page.getByPlaceholder('Enter debate topic...').fill('Leave Test Room')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // Click EXIT ROOM
    await page.getByText('EXIT ROOM').click()

    // Should redirect to browse
    await expect(page).toHaveURL('/browse', { timeout: 10000 })
  })
})
