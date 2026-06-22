import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers.js';

test.describe('Editor', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page);
    // Reset server data so each test starts from a clean slate.
    await page.request.post('/api/save', {
      data: { scenes: [], adventures: [], campaigns: [] },
    });
  });

  test('home page links to editor', async ({ page }) => {
    await page.click('a[href="editor.html"]');
    await expect(page).toHaveURL('/editor.html');
  });

  test('editor loads with empty scene list', async ({ page }) => {
    await page.goto('/editor.html');
    await expect(page.locator('#scenes-empty')).toBeVisible();
  });

  test('can create a scene and see it in the list', async ({ page }) => {
    await page.goto('/editor.html');

    await page.click('#add-scene-btn');
    await page.fill('[name="title"]', 'E2E Test Scene');
    await page.fill('[name="id"]', 'e2e-scene');
    await page.click('#scene-form button[type="submit"]');

    // Scene panel should close and the new scene should appear in the list
    await expect(page.locator('#scene-edit-panel')).toBeHidden();
    await expect(page.locator('#scenes-list')).toContainText('E2E Test Scene');
  });

  test('saved scene persists after page reload', async ({ page }) => {
    await page.goto('/editor.html');

    // Create a scene
    await page.click('#add-scene-btn');
    await page.fill('[name="title"]', 'Persistent Scene');
    await page.fill('[name="id"]', 'persistent-scene');
    await page.click('#scene-form button[type="submit"]');

    // Reload — data comes from server so it should still be there
    await page.reload();
    await expect(page.locator('#scenes-list')).toContainText('Persistent Scene');
  });
});
