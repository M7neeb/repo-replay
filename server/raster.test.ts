import { inflateSync } from 'node:zlib';
import { readPng } from '../test/png';
import { describe, expect, it } from 'vitest';
import { loadGlyphs, Raster, rgb, zlibRows } from './raster';

const pixel = (img: { w: number; rows: Uint8Array }, x: number, y: number) => {
  const o = y * (img.w * 3 + 1) + 1 + x * 3;
  return [img.rows[o], img.rows[o + 1], img.rows[o + 2]];
};

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

describe('the PNG encoder', () => {
  it('writes streams that zlib reads back byte for byte', () => {
    const row = 101 * 3;
    const h = 37;
    const cases: [string, (px: Uint8Array) => void][] = [
      ['flat', (px) => px.fill(255)],
      ['noise', (px) => { const r = seeded(1); for (let i = 0; i < px.length; i++) px[i] = (r() * 256) | 0; }],
      ['runs and repeated pixels', (px) => {
        const r = seeded(7);
        let i = 0;
        while (i < px.length) {
          const kind = r();
          const n = 1 + ((r() * 700) | 0);
          if (kind < 0.4) px.fill((r() * 256) | 0, i, Math.min(px.length, i + n));
          else if (kind < 0.8) { const c = [r() * 256, r() * 256, r() * 256].map((v) => v | 0); for (let k = 0; k < n && i + k < px.length; k++) px[i + k] = c[k % 3]; }
          else for (let k = 0; k < n && i + k < px.length; k++) px[i + k] = (r() * 256) | 0;
          i += n;
        }
      }],
    ];
    // the big sizes run long enough for the checksum to wrap
    for (const [rw, rh] of [[row, h], [1200 * 3, 90]]) {
      for (const [name, fill] of cases) {
        const px = new Uint8Array(rw * rh);
        fill(px);
        const expected = new Uint8Array((rw + 1) * rh);
        for (let y = 0; y < rh; y++) expected.set(px.subarray(y * rw, (y + 1) * rw), y * (rw + 1) + 1);
        // inflateSync also checks the stream's checksum
        expect(Buffer.compare(inflateSync(zlibRows(px, rw, rh)), Buffer.from(expected)), `${name} ${rw}x${rh}`).toBe(0);
      }
    }
  });

  it('makes a PNG of the right size and colours', async () => {
    const r = new Raster(40, 20, rgb('#ffffff'), await loadGlyphs());
    r.rect(10, 5, 20, 15, rgb('#257de0'));
    const img = readPng(r.png());
    expect([img.w, img.h]).toEqual([40, 20]);
    expect(pixel(img, 0, 0)).toEqual([255, 255, 255]);
    expect(pixel(img, 15, 10)).toEqual([0x25, 0x7d, 0xe0]);
  });
});

describe('drawing', () => {
  it('fills a band between two lines, softly at its edges', async () => {
    const r = new Raster(20, 20, rgb('#ffffff'), await loadGlyphs());
    r.band([0, 20], [5.5, 5.5], [15, 15], rgb('#000000'), 1);
    const img = readPng(r.png());
    expect(pixel(img, 10, 2)).toEqual([255, 255, 255]);
    expect(pixel(img, 10, 10)).toEqual([0, 0, 0]);
    expect(pixel(img, 10, 5)[0]).toBeGreaterThan(100);
    expect(pixel(img, 10, 5)[0]).toBeLessThan(160);
  });

  it('sets text from the glyphs, and draws characters it lacks as "?"', async () => {
    const r = new Raster(200, 40, rgb('#ffffff'), await loadGlyphs());
    expect(r.measure('files', 'r22')).toBeGreaterThan(40);
    expect(r.measure('→', 'r22')).toBe(r.measure('?', 'r22'));
    const width = r.text('10,239', 10, 30, 'b42', rgb('#000000'));
    const img = readPng(r.png());
    let inked = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 200; x++) if (pixel(img, x, y)[0] < 128) inked++;
    expect(inked).toBeGreaterThan(200);
    // nothing past the measured width
    for (let y = 0; y < 40; y++) for (let x = Math.ceil(10 + width) + 2; x < 200; x++) expect(pixel(img, x, y)).toEqual([255, 255, 255]);
  });

  it('draws a thick line that covers its whole width', async () => {
    const r = new Raster(30, 30, rgb('#ffffff'), await loadGlyphs());
    r.polyline([[2, 15], [28, 15]], 4, rgb('#000000'));
    r.polyline([[15, 28], [15, 2]], 2, rgb('#ff0000'));
    const img = readPng(r.png());
    expect(pixel(img, 8, 14)).toEqual([0, 0, 0]);
    expect(pixel(img, 8, 15)).toEqual([0, 0, 0]);
    expect(pixel(img, 8, 10)).toEqual([255, 255, 255]);
    expect(pixel(img, 14, 5)).toEqual([255, 0, 0]);
  });
});
