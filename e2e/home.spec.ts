import { expect, test } from '@playwright/test';

test('the home page explains itself and accepts a GitHub link', async ({ page }) => {
  await page.route('**/api/replay/*/*', (route) => new Promise((r) => setTimeout(r, 2000)).then(() => route.abort()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'See how any GitHub project grew.' })).toBeVisible();
  await page.getByLabel('GitHub link').fill('https://github.com/sveltejs/svelte');
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(page).toHaveURL(/\/sveltejs\/svelte$/);
  await expect(page.getByRole('status')).toContainText('Looking up sveltejs/svelte');
});

test('explains a bad link and keeps what was typed', async ({ page }) => {
  await page.goto('/');
  const box = page.getByLabel('GitHub link');
  await box.fill('gitlab.com/someone/thing');
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByRole('alert')).toContainText('doesn’t look like a GitHub repo');
  await expect(box).toHaveValue('gitlab.com/someone/thing');
  await expect(page).toHaveURL(/\/$/);
});

test('the example links open a replay', async ({ page }) => {
  await page.route('**/api/replay/*/*', (route) => new Promise((r) => setTimeout(r, 2000)).then(() => route.abort()));
  await page.goto('/');
  await page.getByRole('link', { name: 'torvalds/linux' }).click();
  await expect(page).toHaveURL(/\/torvalds\/linux$/);
  await expect(page.getByRole('status')).toContainText('torvalds/linux');
});

test('any path serves the app, so share links work', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  const res = await page.goto('/sveltejs/svelte');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('link', { name: 'repo-replay' })).toBeVisible();
});

test('the home page fits the screen with no sideways scrolling', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
