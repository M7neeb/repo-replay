import { describe, expect, it } from 'vitest';
import { cardSvg, chartModelFrom, type LightSnapshot } from './chart';
import { graphCardSvg } from './graphCard';
import type { RepoInfo } from './replay';

// Each count on a card is a group whose CSS animation shows it for its stretch of the loop. This plays
// the keyframes the way a browser does (linear in between) and checks that only one count is ever showing.
function opacityAt(frames: [number, number][], p: number): number {
  let prev = frames[0];
  for (const f of frames) {
    if (f[0] >= p) {
      if (f[0] === prev[0]) return f[1];
      return prev[1] + ((f[1] - prev[1]) * (p - prev[0])) / (f[0] - prev[0]);
    }
    prev = f;
  }
  return prev[1];
}

function countsShowing(svg: string, p: number): number {
  const css = /<style>(.*?)<\/style>/s.exec(svg)![1];
  const groups = [...svg.matchAll(/<g class="(\w+)"><text[^>]*text-anchor="end">[\d,]+<\/text>/g)].map((m) => m[1]);
  let showing = 0;
  for (const g of groups) {
    const body = new RegExp(`@keyframes ${g}\\{(.*?)\\}\\}`).exec(css)![1] + '}';
    const frames: [number, number][] = [];
    for (const [, sel, op] of body.matchAll(/([\d.%,]+)\{opacity:([\d.]+)\}/g)) {
      for (const s of sel.split(',')) frames.push([parseFloat(s), Number(op)]);
    }
    if (opacityAt(frames, p) > 0.02) showing++;
  }
  return showing;
}

const repo = (firstAt: number, headAt: number): RepoInfo => ({ owner: 'ana', name: 'young', description: null, stars: 0, branch: 'main', head: 'a'.repeat(40), headAt, firstAt, commits: 20, sampled: false });

describe('the count on a README card', () => {
  // a few days old, with snapshots minutes apart: several of them fall inside the same 0.01% of the loop
  const t0 = 1_795_600_000;
  const ats = [0, 3000, ...Array.from({ length: 40 }, (_, i) => 200_000 + i * 7), 230_000, 240_000];
  const snaps: LightSnapshot[] = ats.map((d, i) => ({ at: t0 + d, files: 10 + i * 5, truncated: false, counts: new Map([['src', 5 + i * 3], ['test', 5 + i * 2]]) }));
  const model = chartModelFrom(repo(t0, t0 + 240_000), snaps, []);

  for (const [name, svg] of [['chart card', cardSvg(model, { theme: 'light' })], ['graph card', graphCardSvg(model, snaps, [], { theme: 'light' })]] as const) {
    it(`never shows two at once on the ${name}`, () => {
      for (let p = 0; p <= 100; p += 0.05) expect(countsShowing(svg, p), `at ${p.toFixed(2)}%`).toBeLessThanOrEqual(1);
      expect(countsShowing(svg, 99)).toBe(1);
    });
  }
});
