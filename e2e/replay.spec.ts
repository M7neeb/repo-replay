import { expect, test, type Page } from '@playwright/test';
import { serveBuild, serveError, serveSaved } from './mockApi';

const scrubber = (page: Page) => page.getByRole('slider', { name: 'Position in the replay' });

test('builds a replay, shows progress, then plays it', async ({ page }) => {
  await serveBuild(page, { slow: true });
  await page.goto('/');
  await page.getByLabel('GitHub link').fill('https://github.com/sveltejs/svelte');
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByRole('status')).toContainText(/Reading the history|Looking at the files/);
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(async () => Number(await scrubber(page).inputValue())).toBeGreaterThan(0);
  await expect(page.getByTestId('caption')).toHaveText('First commit');
  await expect(page.locator('.chart svg')).toBeVisible();
  await expect(page.getByText('saved, so it opens straight away next time')).toBeVisible();
});

test('pausing stops it and the scrubber jumps to any point', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await page.getByRole('button', { name: 'Pause' }).click();
  const at = await scrubber(page).inputValue();
  await page.waitForTimeout(600);
  expect(await scrubber(page).inputValue()).toBe(at);

  await scrubber(page).fill('1000');
  await expect(page.getByTestId('count')).toHaveText('212 files');
  await expect(page.getByTestId('when')).toHaveText('in Nov 2026');
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
  await expect(page.locator('.rows li').first()).toContainText('src/');

  await scrubber(page).fill('0');
  await expect(page.getByTestId('count')).toHaveText('12 files');
  await expect(page.getByTestId('when')).toHaveText('in Nov 2016');
});

test('dragging across the chart moves through time', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  const chart = page.locator('.chart');
  const box = (await chart.boundingBox())!;
  await chart.dispatchEvent('pointerdown', { clientX: box.x + box.width - 4, clientY: box.y + box.height / 2, pointerId: 1, isPrimary: true });
  await expect(page.getByRole('button', { name: /Play/ })).toBeVisible();
  expect(Number(await scrubber(page).inputValue())).toBeGreaterThan(900);
});

test('people who ask for less motion get the finished chart, not an animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await expect(page.getByTestId('count')).toHaveText('212 files');
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
});

test('a shared link opens the saved replay straight away', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toBeVisible();
  await expect(page).toHaveTitle('sveltejs/svelte · repo-replay');
});

test('the numbers are also there as a table', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await page.getByText('Show as a table').click();
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByRole('row', { name: /2026/ })).toContainText('212');
});

test('copy link puts the replay address on the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'clipboard permissions are a Chromium feature in Playwright');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/sveltejs\/svelte$/);
});

test('copy puts the README line on the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'clipboard permissions are a Chromium feature in Playwright');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('/api/card/sveltejs/svelte.svg?theme=dark');
  expect(text).toContain('<picture>');
});

test('back goes home and forward opens the replay again', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/');
  await page.getByLabel('GitHub link').fill('sveltejs/svelte');
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'See how any GitHub project grew.' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toBeVisible();
});

test('another repo goes back to the paste box', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await page.getByRole('link', { name: 'Another repo' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel('GitHub link')).toBeVisible();
});

for (const [name, status, body, text] of [
  ['a private or missing repo says so', 404, { error: 'not_found' }, 'This repo is private or doesn’t exist. repo-replay only works with public repos.'],
  ['an empty repo says there is nothing to replay yet', 422, { error: 'empty' }, 'nothing to replay yet'],
] as const) {
  test(name, async ({ page }) => {
    await serveError(page, status, body);
    await page.goto('/someone/thing');
    await expect(page.getByRole('alert')).toContainText(text);
    await expect(page.getByLabel('GitHub link')).toHaveValue('github.com/someone/thing');
  });
}

test('when GitHub is busy it says when to try again', async ({ page }) => {
  await serveError(page, 503, { error: 'busy', retryAt: Math.floor(Date.now() / 1000) + 1800 });
  await page.goto('/someone/busy');
  await expect(page.getByRole('alert')).toContainText(/Try this one again after \d{1,2}:\d{2}/);
  await expect(page.getByRole('alert')).toContainText('Replays already saved still open');
});

test('a lost connection says so', async ({ page }) => {
  await page.route('**/api/replay/*/*', (route) => route.abort('internetdisconnected'));
  await page.goto('/someone/offline');
  await expect(page.getByRole('alert')).toContainText('Couldn’t connect');
});

test('the replay fits the screen with no sideways scrolling', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await expect(page.locator('.chart svg')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
