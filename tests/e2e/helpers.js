export const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-test-password';

// Log in via the UI and return the page (now at home).
export async function loginViaUI(page) {
  await page.goto('/login');
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
}
