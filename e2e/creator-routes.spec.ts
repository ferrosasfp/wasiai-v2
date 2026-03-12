import { test, expect } from '@playwright/test'

test.describe('Creator Routes Security (Auth Guard)', () => {
  test('should redirect unauthenticated users to login when accessing pipelines', async ({ page }) => {
    await page.goto('/en/pipelines')
    await expect(page).toHaveURL(/.*\/login/)
  })

  test('should redirect unauthenticated users to login when accessing publish', async ({ page }) => {
    await page.goto('/en/publish')
    await expect(page).toHaveURL(/.*\/login/)
  })

  test('should redirect unauthenticated users to login when accessing agent keys', async ({ page }) => {
    await page.goto('/en/agent-keys')
    await expect(page).toHaveURL(/.*\/login/)
  })

  test('should redirect unauthenticated users to login when accessing dashboard', async ({ page }) => {
    await page.goto('/en/creator/dashboard')
    await expect(page).toHaveURL(/.*\/login/)
  })
})
