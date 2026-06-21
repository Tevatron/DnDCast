import { test, expect } from '@playwright/test';
import { loginViaUI, PASSWORD } from './helpers.js';

test.describe('Auth flow', () => {
  test('unauthenticated visit redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('login page is reachable without auth', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('wrong password shows error message', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="password"]', 'definitely-wrong');
    await page.click('button[type="submit"]');
    await expect(page.locator('#login-error')).toBeVisible();
    // Should stay on /login
    await expect(page).toHaveURL('/login');
  });

  test('correct password reaches home page', async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL('/');
    // Home page shows the three mode cards
    await expect(page.locator('.home-card')).toHaveCount(3);
  });

  test('authenticated user visiting /login redirects to home', async ({ page }) => {
    await loginViaUI(page);
    await page.goto('/login');
    await expect(page).toHaveURL('/');
  });
});
