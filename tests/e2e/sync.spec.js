import { test, expect, request } from '@playwright/test';
import { loginViaUI, PASSWORD } from './helpers.js';

// Helper: log in and reach the player page in a given Playwright page object.
async function startPlayer(page, role = '') {
  await loginViaUI(page);
  const url = role ? `/player.html?role=${role}` : '/player.html';
  await page.goto(url);
  await page.click('#start-btn');
}

test.describe.configure({ mode: 'serial' });

test.describe('DM / Cast sync', () => {
  test.beforeEach(async ({ request }) => {
    // Clear cached WS state so each test starts with no lastState.
    await request.post('/_test_/reset');

    // Seed scenes so loadData() succeeds and startSession() shows waitingOverlay.
    // The request fixture maintains cookies, so login → save works in sequence.
    await request.post('/api/login', { data: { password: PASSWORD } });
    await request.post('/api/save', {
      data: {
        scenes:    [{ id: 'sync-scene-a', title: 'Scene Alpha' },
                    { id: 'sync-scene-b', title: 'Scene Beta' }],
        sessions:  [{ id: 'sync-session', title: 'Sync Session',
                      scenes: ['sync-scene-a', 'sync-scene-b'] }],
        campaigns: [],
      },
    });
  });

  test('cast tab shows "Waiting for DM" before DM connects', async ({ page }) => {
    await startPlayer(page, '');
    await expect(page.locator('#waiting-overlay')).toBeVisible();
  });

  test('DM tab shows DM badge and no waiting overlay', async ({ page }) => {
    await startPlayer(page, 'dm');
    await expect(page.locator('#dm-badge')).toBeVisible();
    await expect(page.locator('#waiting-overlay')).toBeHidden();
  });

  test('scene change on DM propagates to cast tab', async ({ browser }) => {
    // Data is already seeded by beforeEach — open DM and cast contexts directly.

    // Open cast tab and DM tab in separate contexts (separate sessions/cookies).
    const castCtx = await browser.newContext();
    const dmCtx   = await browser.newContext();
    const castPage = await castCtx.newPage();
    const dmPage   = await dmCtx.newPage();

    try {
      // Start cast tab — it will wait for DM.
      await startPlayer(castPage, '');
      await expect(castPage.locator('#waiting-overlay')).toBeVisible();

      // Start DM tab and pick the session.
      await startPlayer(dmPage, 'dm');
      // No campaign, so session picker opens directly.
      await dmPage.locator('#session-overlay .picker-card', { hasText: 'Sync Session' }).click();

      // Cast tab should leave waiting state and show the first scene title.
      await expect(castPage.locator('#waiting-overlay')).toBeHidden({ timeout: 5000 });
      await expect(castPage.locator('#scene-counter')).toContainText('1 /');

      // DM advances to next scene.
      await dmPage.click('#next-btn');
      await expect(castPage.locator('#scene-counter')).toContainText('2 /', { timeout: 5000 });
    } finally {
      await castCtx.close();
      await dmCtx.close();
    }
  });
});
