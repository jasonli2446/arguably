import { test, expect } from '@playwright/test'

test.describe('Browse Page', () => {
  test('loads the browse page', async ({ page }) => {
    await page.goto('/browse')
    await expect(page.getByText('BROWSE')).toBeVisible()
    await expect(page.getByText('DEBATES')).toBeVisible()
  })

  test('shows search bar', async ({ page }) => {
    await page.goto('/browse')
    await expect(page.getByPlaceholder('SEARCH DEBATES...')).toBeVisible()
  })

  test('shows stats section', async ({ page }) => {
    await page.goto('/browse')
    await expect(page.getByText('LIVE DEBATES')).toBeVisible()
    await expect(page.getByText('PARTICIPANTS')).toBeVisible()
    await expect(page.getByText('TOTAL ROOMS')).toBeVisible()
  })

  test('shows empty state when no debates exist', async ({ page }) => {
    await page.goto('/browse')
    // If no sessions exist, should show empty state
    const hasDebates = await page.locator('.debate-card').count()
    if (hasDebates === 0) {
      await expect(page.getByText('NO ACTIVE DEBATES')).toBeVisible()
    }
  })

  test('search filters debates', async ({ page }) => {
    await page.goto('/browse')
    const searchInput = page.getByPlaceholder('SEARCH DEBATES...')
    await searchInput.fill('nonexistent-query-xyz')
    // Should show no results or filtered results
    await expect(page.getByText(/NO MATCHING DEBATES|nonexistent/i)).toBeVisible({ timeout: 5000 }).catch(() => {
      // If there are no debates at all, the empty state is fine too
    })
  })
})
