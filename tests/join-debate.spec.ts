import { test, expect } from '@playwright/test'

test.describe('Join Debate', () => {
  test('can create and enter a room via the create flow', async ({ page }) => {
    await page.goto('/create')
    await expect(page.getByText('CREATE DEBATE ROOM')).toBeVisible()

    // Fill in room name and create
    await page.getByPlaceholder('Enter debate topic...').fill('Join Test Room')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    // Should redirect to the room page
    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // Verify we're in the room with correct structure
    await expect(page.getByText(/ARG-\d{4}/)).toBeVisible()
    await expect(page.getByText('EXIT ROOM')).toBeVisible()
  })

  test('browse page shows join buttons when debates exist', async ({ page }) => {
    await page.goto('/browse')

    const debateCards = page.locator('.debate-card')
    const count = await debateCards.count()

    if (count > 0) {
      await expect(debateCards.first().getByText('JOIN DEBATE')).toBeVisible()
    }
  })
})
