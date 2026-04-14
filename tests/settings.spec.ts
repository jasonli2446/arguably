import { test, expect } from '@playwright/test'

test.describe('Settings Page', () => {
  test('loads the settings page', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('h1', { hasText: 'SETTINGS' })).toBeVisible()
    await expect(page.getByText('Configure your debate experience')).toBeVisible()
  })

  test('shows all settings sections', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('PROFILE')).toBeVisible()
    await expect(page.getByText('NOTIFICATIONS')).toBeVisible()
    await expect(page.getByText('PRIVACY')).toBeVisible()
    await expect(page.getByText('AUDIO')).toBeVisible()
    await expect(page.getByText('APPEARANCE')).toBeVisible()
    await expect(page.getByText('LANGUAGE & REGION')).toBeVisible()
  })

  test('shows danger zone', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('DANGER ZONE')).toBeVisible()
    await expect(page.getByText('Delete Account')).toBeVisible()
  })

  test('shows save and cancel buttons', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('SAVE CHANGES')).toBeVisible()
    await expect(page.getByText('CANCEL')).toBeVisible()
  })
})
