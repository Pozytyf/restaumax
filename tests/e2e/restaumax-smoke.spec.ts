import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // The smoke suite must never contact Firebase or another external service.
  // It validates only the built SPA shell and client-side route hydration.
  await page.route('https://**/*', (route) => route.abort());
});

test('homepage loads and hydrates the RestauMax application', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/RestauMax/);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(() => page.locator('#root').evaluate((root) => root.childElementCount)).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test('QR customer deep link is served by the SPA and hydrates', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const response = await page.goto('/r/chez-awa?table=4');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/RestauMax/);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(() => page.locator('#root').evaluate((root) => root.childElementCount)).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test('management deep link is served without a blank application shell', async ({ page }) => {
  const response = await page.goto('/gestion');
  expect(response?.status()).toBe(200);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(() => page.locator('#root').evaluate((root) => root.childElementCount)).toBeGreaterThan(0);
});
