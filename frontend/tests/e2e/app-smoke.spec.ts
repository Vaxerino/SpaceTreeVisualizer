import { expect, test } from '@playwright/test';

test('loads the app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SpaceTreeVisualizer/);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#canvas')).toBeVisible();
});
