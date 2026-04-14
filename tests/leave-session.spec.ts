import { test, expect } from '@playwright/test'

test.describe('Leave Session', () => {
  test('EXIT ROOM button returns to browse page', async ({ page }) => {
    // Create a room first
    await page.goto('/create')
    await page.getByPlaceholder('Enter debate topic...').fill('Leave Test Room')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // Wait for room to fully load before clicking EXIT
    await expect(page.getByText('EXIT ROOM')).toBeVisible()

    // Click EXIT ROOM and wait for navigation
    await page.getByText('EXIT ROOM').click()

    // The leaveSession server action runs then router.push('/browse')
    await page.waitForURL('**/browse', { timeout: 15000 })
    await expect(page).toHaveURL(/\/browse/)
  })
})
