import { expect, test } from '@playwright/test';
import { serveSaved, serveShowcase } from './mockApi';

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

test('the home page plays a saved example, without asking GitHub', async ({ page }) => {
  await serveShowcase(page);
  const asked: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/replay')) asked.push(r.url()); });
  await page.goto('/');
  const example = page.getByRole('region', { name: 'Example' });
  await expect(example.getByRole('heading', { level: 2, name: 'sveltejs/svelte' })).toBeVisible();
  await example.scrollIntoViewIfNeeded();
  // it starts once it is on screen
  await expect(example.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(example.getByText('What it’s made of')).toHaveCount(0);
  expect(asked).toEqual([]);

  await serveSaved(page);
  await example.getByRole('link', { name: 'Open the full replay' }).click();
  await expect(page).toHaveURL(/\/sveltejs\/svelte$/);
  await expect(page.getByRole('heading', { level: 1, name: 'sveltejs/svelte' })).toBeVisible();
});

test('with no saved example the home page just shows the paste box', async ({ page }) => {
  await page.route('**/api/saved/**', (route) => route.fulfill({ status: 404, json: { error: 'not_found' } }));
  await page.goto('/');
  await expect(page.getByLabel('GitHub link')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('region', { name: 'Example' })).toHaveCount(0);
});

test('the home page fits the screen with no sideways scrolling', async ({ page }) => {
  await serveShowcase(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Example' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
