import { expect, test } from '@playwright/test';
import { serveBuild, serveError, serveSaved } from './mockApi';

test('builds a replay and shows the history year by year', async ({ page }) => {
  await serveBuild(page, { slow: true });
  await page.goto('/');
  await page.getByLabel('GitHub link').fill('https://github.com/sveltejs/svelte');
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByRole('status')).toContainText('sveltejs/svelte');
  await expect(page.getByRole('status')).toContainText(/Reading the history|Looking at the files/);
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toBeVisible();
  await expect(page).toHaveURL(/\/sveltejs\/svelte$/);
  await expect(page.getByText('26 Nov 2016')).toBeVisible();
  const table = page.getByRole('table', { name: 'Year by year, lines of code added and removed' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByRole('row', { name: /2016/ })).toContainText('2');
  await expect(page.getByTestId('source')).toContainText('saved, so it opens straight away next time');
});

test('a shared link opens the saved replay straight away', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toBeVisible();
  await expect(page.getByLabel('GitHub link')).toHaveValue('github.com/sveltejs/svelte');
  await expect(page.getByTestId('source')).toContainText('Opened the saved replay');
});

test('back goes home and forward opens the replay again', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/');
  await page.getByLabel('GitHub link').fill('sveltejs/svelte');
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'sveltejs/svelte' })).toBeVisible();
});

test('a private or missing repo says so', async ({ page }) => {
  await serveError(page, 404, { error: 'not_found' });
  await page.goto('/someone/nothing-here');
  await expect(page.getByRole('alert')).toHaveText('This repo is private or doesn’t exist. repo-replay only works with public repos.');
});

test('an empty repo says there is nothing to replay yet', async ({ page }) => {
  await serveError(page, 422, { error: 'empty' });
  await page.goto('/someone/empty');
  await expect(page.getByRole('alert')).toContainText('nothing to replay yet');
});

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

test('the history table fits the phone screen', async ({ page }) => {
  await serveSaved(page);
  await page.goto('/sveltejs/svelte');
  await expect(page.getByRole('table')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const tableOverflow = await page.evaluate(() => {
    const box = document.querySelector('.table')!;
    return box.scrollWidth - box.clientWidth;
  });
  expect(tableOverflow).toBeLessThanOrEqual(0);
});
