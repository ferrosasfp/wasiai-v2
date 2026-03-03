import { test, expect } from '@playwright/test'

test.describe('Language Switcher (AC-3)', () => {
  test('EN→ES: /en/login switches to /es/login', async ({ page }) => {
    await page.goto('/en/login')
    await page.locator('[data-testid="lang-es"]').click()
    await expect(page).toHaveURL(/\/es\/login/)
  })

  test('ES→EN: /es/login switches to /en/login', async ({ page }) => {
    await page.goto('/es/login')
    await page.locator('[data-testid="lang-en"]').click()
    await expect(page).toHaveURL(/\/en\/login/)
  })

  test('regression S17: no double-locale /en/es/login', async ({ page }) => {
    await page.goto('/en/login')
    await page.locator('[data-testid="lang-es"]').click()
    const url = page.url()
    expect(url).not.toMatch(/\/en\/es\//)
    await expect(page).toHaveURL(/\/es\/login/)
  })

  test('active locale button has aria-pressed=true', async ({ page }) => {
    await page.goto('/en/login')
    await expect(page.locator('[data-testid="lang-en"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-testid="lang-es"]')).toHaveAttribute('aria-pressed', 'false')
  })

  test('switch preserves path on language change', async ({ page }) => {
    await page.goto('/en/login')
    await page.locator('[data-testid="lang-es"]').click()
    await expect(page).toHaveURL(/\/es\/login/)
  })
})
