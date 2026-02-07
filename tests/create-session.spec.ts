import { test, expect } from '@playwright/test'

test.describe('Create Session Page', () => {
  test('loads the create room page', async ({ page }) => {
    await page.goto('/create')
    // May redirect to /auth if not logged in — that's expected
    const url = page.url()
    if (url.includes('/auth')) {
      // Not authenticated — verify auth page loaded
      await expect(page.getByText('SIGN IN')).toBeVisible()
    } else {
      // Authenticated — verify create page loaded
      await expect(page.getByText('CREATE DEBATE ROOM')).toBeVisible()
    }
  })

  test('shows all debate format options', async ({ page }) => {
    await page.goto('/create')
    if (page.url().includes('/auth')) return // Skip if not authenticated

    await expect(page.getByText('EXPERT vs CROWD')).toBeVisible()
    await expect(page.getByText('ONE-ON-ONE')).toBeVisible()
    await expect(page.getByText('TEAM DEBATE')).toBeVisible()
    await expect(page.getByText('PANEL DISCUSSION')).toBeVisible()
  })

  test('shows preview room code', async ({ page }) => {
    await page.goto('/create')
    if (page.url().includes('/auth')) return

    await expect(page.getByText(/ARG-\d{4}/)).toBeVisible()
  })

  test('shows error when creating room without name', async ({ page }) => {
    await page.goto('/create')
    if (page.url().includes('/auth')) return

    await page.getByText('CREATE ROOM').click()
    // Should show an error since no room name was provided
    await expect(page.getByText(/required|error/i)).toBeVisible({ timeout: 10000 })
  })
})
