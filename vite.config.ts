/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The headers Cloudflare adds to every page (public/_headers), so the local preview and the browser
// tests run under the same rules as the live site.
function siteHeaders(): Record<string, string> {
  const lines = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split('\n');
  return Object.fromEntries(
    lines.filter((l) => /^\s+\S+:/.test(l)).map((l) => {
      const at = l.indexOf(':');
      return [l.slice(0, at).trim(), l.slice(at + 1).trim()];
    }),
  );
}

export default defineConfig({
  plugins: [svelte()],
  preview: { headers: siteHeaders() },
  test: {
    include: ['src/**/*.test.ts', 'functions/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
