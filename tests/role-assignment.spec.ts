import { test, expect } from '@playwright/test'

test.describe('Role Assignment', () => {
  test('creator is assigned HOST role in room', async ({ page }) => {
    await page.goto('/create')
    await page.getByPlaceholder('Enter debate topic...').fill('Role Test Room')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // In the participants panel, the creator should have HOST indicator
    await expect(page.getByText('HOST')).toBeVisible()
  })

  test('moderator card is visible in sidebar', async ({ page }) => {
    await page.goto('/create')
    await page.getByPlaceholder('Enter debate topic...').fill('Mod Card Test Room')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // Wait for room to fully render, then check moderator section
    await expect(page.getByText('MODERATOR')).toBeVisible({ timeout: 10000 })
  })
})
