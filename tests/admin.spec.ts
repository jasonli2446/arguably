import { test, expect } from '@playwright/test'

test.describe('Admin Panel', () => {
  test('redirects non-admin users away from /admin', async ({ page }) => {
    // The authenticated test user has role USER (not ADMIN)
    // The admin layout should redirect to /browse
    await page.goto('/admin')
    await page.waitForURL(/\/(browse|auth)/)
    expect(page.url()).not.toContain('/admin')
  })

  test('admin route is not accessible without authentication', async ({ browser }) => {
    // Create a new context without auth state
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/admin')
    await page.waitForURL(/\/auth/)
    expect(page.url()).toContain('/auth')
    await context.close()
  })
})
