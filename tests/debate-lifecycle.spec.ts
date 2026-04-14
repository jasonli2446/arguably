import { test, expect } from '@playwright/test'

test.describe('Debate Lifecycle', () => {
  test('shows waiting state with start debate button after room creation', async ({ page }) => {
    await page.goto('/create')
    await page.getByPlaceholder('Enter debate topic...').fill('Debate Lifecycle Test')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // Room should be in WAITING state
    await expect(page.getByText('WAITING FOR PARTICIPANTS')).toBeVisible()
    await expect(page.getByText(/joined/)).toBeVisible()
  })

  test('start debate button is disabled without enough debaters', async ({ page }) => {
    await page.goto('/create')
    await page.getByPlaceholder('Enter debate topic...').fill('Debate Start Test')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // START DEBATE should be visible but disabled (host is alone, needs 2+ debaters)
    const startButton = page.getByRole('button', { name: 'START DEBATE' })
    await expect(startButton).toBeVisible()
    await expect(startButton).toBeDisabled()
  })

  test('room shows correct status badge in waiting state', async ({ page }) => {
    await page.goto('/create')
    await page.getByPlaceholder('Enter debate topic...').fill('Status Badge Test')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()

    await page.waitForURL(/\/room\/ARG-\d{4}/, { timeout: 15000 })

    // Status badge should show WAITING
    await expect(page.getByText('WAITING').first()).toBeVisible()
  })
})
