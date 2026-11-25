import { expect, test } from '@playwright/test';

test('accepts a GitHub link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'repo-replay' })).toBeVisible();
  await page.getByLabel('GitHub link').fill('https://github.com/sveltejs/svelte');
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByRole('status')).toContainText('sveltejs/svelte');
});

test('explains a bad link and keeps what was typed', async ({ page }) => {
  await page.goto('/');
  const box = page.getByLabel('GitHub link');
  await box.fill('gitlab.com/someone/thing');
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByRole('alert')).toContainText('doesn’t look like a GitHub repo');
  await expect(box).toHaveValue('gitlab.com/someone/thing');
});

test('any path serves the app, so share links will work', async ({ page }) => {
  const res = await page.goto('/sveltejs/svelte');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'repo-replay' })).toBeVisible();
});

test('fits the screen with no sideways scrolling', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
