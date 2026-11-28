import { BITMAPS, FIRST, FONTS, PHASES } from './glyphs';

// A small drawing surface for the share image. Rendering an SVG with a full engine takes about 50 ms of
// CPU, five times what a free Cloudflare function may use, so the image is drawn from the chart's shapes
// directly: filled bands, thick lines, discs, rectangles and text from pre-rendered glyphs.

export type FontKey = keyof typeof FONTS;
export type RGB = readonly [number, number, number];

export const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

let glyphBytes: Promise<Uint8Array> | null = null;
export function loadGlyphs(): Promise<Uint8Array> {
  glyphBytes ??= (async () => {
    const packed = Uint8Array.from(atob(BITMAPS), (c) => c.charCodeAt(0));
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  })();
  return glyphBytes;
}

/** How much of the pixel span [p, p + 1] lies inside [a, b]. */
const overlap = (p: number, a: number, b: number) => Math.max(0, Math.min(p + 1, b) - Math.max(p, a));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Raster {
  readonly px: Uint8Array;
  private readonly mask: Uint8Array;
  private readonly rowFrom: Int32Array;
  private readonly rowTo: Int32Array;

  constructor(
    readonly w: number,
    readonly h: number,
    background: RGB,
    private readonly glyphs: Uint8Array,
  ) {
    this.px = new Uint8Array(w * h * 3);
    this.px.set(background);
    for (let filled = 3; filled < this.px.length; filled *= 2) this.px.copyWithin(filled, 0, Math.min(filled, this.px.length - filled));
    this.mask = new Uint8Array(w * h);
    this.rowFrom = new Int32Array(h);
    this.rowTo = new Int32Array(h);
  }

  private put(i: number, c: RGB, a: number) {
    const px = this.px;
    const j = i * 3;
    px[j] = (px[j] + (c[0] - px[j]) * a + 0.5) | 0;
    px[j + 1] = (px[j + 1] + (c[1] - px[j + 1]) * a + 0.5) | 0;
    px[j + 2] = (px[j + 2] + (c[2] - px[j + 2]) * a + 0.5) | 0;
  }

  /** An axis-aligned rectangle with soft edges where it covers part of a pixel. */
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, alpha = 1) {
    const cx0 = Math.max(0, Math.floor(x0)), cx1 = Math.min(this.w, Math.ceil(x1));
    const cy0 = Math.max(0, Math.floor(y0)), cy1 = Math.min(this.h, Math.ceil(y1));
    for (let y = cy0; y < cy1; y++) {
      const ay = overlap(y, y0, y1) * alpha;
      for (let x = cx0; x < cx1; x++) this.put(y * this.w + x, c, ay * overlap(x, x0, x1));
    }
  }

  /** A rectangle with round corners of radius r. */
  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB, alpha = 1) {
    const cx = x + w / 2, cy = y + h / 2, hx = w / 2 - r, hy = h / 2 - r;
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(this.h, Math.ceil(y + h)); py++) {
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(this.w, Math.ceil(x + w)); px++) {
        const qx = Math.abs(px + 0.5 - cx) - hx, qy = Math.abs(py + 0.5 - cy) - hy;
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
        const a = clamp01(0.5 - d);
        if (a > 0) this.put(py * this.w + px, c, a * alpha);
      }
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB) {
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y < Math.min(this.h, Math.ceil(cy + r + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r - 1)); x < Math.min(this.w, Math.ceil(cx + r + 1)); x++) {
        const a = clamp01(r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
        if (a > 0) this.put(y * this.w + x, c, a);
      }
    }
  }

  /**
   * The area between two lines that share their x positions (ascending), like one layer of a stacked
   * chart: `top[i]` and `bottom[i]` are the y values at `xs[i]`.
   */
  band(xs: number[], top: number[], bottom: number[], c: RGB, alpha: number) {
    const n = xs.length;
    if (n < 2) return;
    const xa = xs[0], xb = xs[n - 1];
    let s = 0;
    for (let col = Math.max(0, Math.floor(xa)); col < Math.min(this.w, Math.ceil(xb)); col++) {
      const cx = Math.min(Math.max(col + 0.5, xa), xb);
      while (s < n - 2 && xs[s + 1] <= cx) s++;
      const span = xs[s + 1] - xs[s];
      const f = span > 0 ? (cx - xs[s]) / span : 1;
      const yt = top[s] + (top[s + 1] - top[s]) * f;
      const yb = bottom[s] + (bottom[s + 1] - bottom[s]) * f;
      if (yb <= yt) continue;
      const hc = overlap(col, xa, xb) * alpha;
      for (let row = Math.max(0, Math.floor(yt)); row < Math.min(this.h, Math.ceil(yb)); row++) {
        this.put(row * this.w + col, c, overlap(row, yt, yb) * hc);
      }
    }
  }

  /** A line through the points, `width` thick, with round joins. Overlaps at the joins are painted once. */
  polyline(points: [number, number][], width: number, c: RGB, alpha = 1) {
    const hw = width / 2;
    const { w, h, mask, rowFrom, rowTo } = this;
    let by0 = h, by1 = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 1)), x1 = Math.min(w, Math.ceil(Math.max(ax, bx) + hw + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - hw - 1)), y1 = Math.min(h, Math.ceil(Math.max(ay, by) + hw + 1));
      if (y0 < by0) for (let y = y0; y < by0; y++) [rowFrom[y], rowTo[y]] = [w, 0];
      if (y1 > by1) for (let y = Math.max(by1, y0); y < y1; y++) [rowFrom[y], rowTo[y]] = [w, 0];
      by0 = Math.min(by0, y0);
      by1 = Math.max(by1, y1);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const reach = hw + 1;
      for (let y = y0; y < y1; y++) {
        // only the stretch of this row that the thick segment can reach
        let xa = x0, xb = x1;
        if (dy !== 0) {
          const ta = Math.min(1, Math.max(0, (y - reach - ay) / dy));
          const tb = Math.min(1, Math.max(0, (y + 1 + reach - ay) / dy));
          const xta = ax + ta * dx, xtb = ax + tb * dx;
          xa = Math.max(x0, Math.floor(Math.min(xta, xtb) - reach));
          xb = Math.min(x1, Math.ceil(Math.max(xta, xtb) + reach));
        }
        if (xa < rowFrom[y]) rowFrom[y] = xa;
        if (xb > rowTo[y]) rowTo[y] = xb;
        for (let x = xa; x < xb; x++) {
          const px = x + 0.5 - ax, py = y + 0.5 - ay;
          const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
          const ex = px - t * dx, ey = py - t * dy;
          const d = Math.sqrt(ex * ex + ey * ey);
          const m = (clamp01(hw + 0.5 - d) * 255 + 0.5) | 0;
          const i = y * w + x;
          if (m > mask[i]) mask[i] = m;
        }
      }
    }
    // only the parts of each row that a segment touched
    for (let y = by0; y < by1; y++) {
      for (let x = rowFrom[y]; x < rowTo[y]; x++) {
        const i = y * w + x;
        if (mask[i]) {
          this.put(i, c, (mask[i] / 255) * alpha);
          mask[i] = 0;
        }
      }
    }
  }

  measure(text: string, font: FontKey): number {
    const f = FONTS[font];
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      width += f.adv[code(text, i) - FIRST];
      if (i > 0) width += kern(font, text[i - 1] + text[i]);
    }
    return width;
  }

  /** Text on a baseline at y. Characters outside printable ASCII are drawn as "?". */
  text(text: string, x: number, y: number, font: FontKey, c: RGB, anchor: 'start' | 'middle' | 'end' = 'start'): number {
    const f = FONTS[font];
    const width = this.measure(text, font);
    let pen = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
    const base = Math.round(y);
    for (let i = 0; i < text.length; i++) {
      const k = code(text, i) - FIRST;
      if (i > 0) pen += kern(font, text[i - 1] + text[i]);
      let whole = Math.floor(pen);
      let phase = Math.round((pen - whole) * PHASES);
      if (phase === PHASES) {
        whole += 1;
        phase = 0;
      }
      const [dx, dy, gw, gh, at] = f.glyphs[k][phase];
      for (let gy = 0; gy < gh; gy++) {
        const py = base + dy + gy;
        if (py < 0 || py >= this.h) continue;
        for (let gx = 0; gx < gw; gx++) {
          const v = this.glyphs[at + gy * gw + gx];
          const px = whole + dx + gx;
          if (v && px >= 0 && px < this.w) this.put(py * this.w + px, c, v / 255);
        }
      }
      pen += f.adv[k];
    }
    return width;
  }

  png(): Uint8Array {
    const { w, h, px } = this;
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibRows(px, w * 3, h)), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

// Fixed-code deflate tables, with every code already bit-reversed for writing least significant bit first.
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const reverse = (v: number, n: number) => {
  let r = 0;
  for (let i = 0; i < n; i++) r |= ((v >> i) & 1) << (n - 1 - i);
  return r;
};
function fixedCode(sym: number): [number, number] {
  if (sym < 144) return [reverse(0x30 + sym, 8), 8];
  if (sym < 256) return [reverse(0x190 + sym - 144, 9), 9];
  if (sym < 280) return [reverse(sym - 256, 7), 7];
  return [reverse(0xc0 + sym - 280, 8), 8];
}
let tables: { litBits: Uint32Array; litLen: Uint8Array; runBits: Uint32Array; runLen: Uint8Array } | null = null;
function deflateTables() {
  if (tables) return tables;
  const litBits = new Uint32Array(256), litLen = new Uint8Array(256);
  for (let s = 0; s < 256; s++) [litBits[s], litLen[s]] = fixedCode(s);
  // a copy of n bytes: the length code and its extra bits; the 5-bit distance code goes after them
  const runBits = new Uint32Array(259), runLen = new Uint8Array(259);
  for (let n = 3; n <= 258; n++) {
    let c = LEN_BASE.length - 1;
    while (LEN_BASE[c] > n) c--;
    const [bits, len] = fixedCode(257 + c);
    runBits[n] = bits | ((n - LEN_BASE[c]) << len);
    runLen[n] = len + LEN_EXTRA[c];
  }
  return (tables = { litBits, litLen, runBits, runLen });
}
const BACK_1 = reverse(0, 5);
const BACK_3 = reverse(2, 5);

/** How many bytes from `at` (up to `limit`) equal v, checking four at a time where it can. */
function sameBytes(px: Uint8Array, words: Uint32Array, at: number, limit: number, v: number): number {
  let n = 0;
  while (n < limit && ((at + n) & 3) !== 0 && px[at + n] === v) n++;
  if (((at + n) & 3) === 0) {
    const word = (v * 0x01010101) >>> 0;
    let q = (at + n) >> 2;
    while (n + 4 <= limit && q < words.length && words[q] === word) {
      n += 4;
      q++;
    }
  }
  while (n < limit && px[at + n] === v) n++;
  return n;
}

/**
 * The zlib stream for unfiltered PNG rows of `row` bytes. It only looks for the previous byte or the
 * previous pixel repeating, which is nearly all a flat chart holds, and works out the checksum of a
 * repeated byte in one step. Much less thorough than zlib, but fast enough for a free function's CPU limit.
 */
export function zlibRows(px: Uint8Array, row: number, h: number): Uint8Array {
  const { litBits, litLen, runBits, runLen } = deflateTables();
  const words = new Uint32Array(px.buffer, px.byteOffset, px.byteLength >> 2);
  const out = new Uint8Array(Math.ceil(((row + 1) * h * 9) / 8) + 64);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  let buf = 3; // last block, fixed codes
  let cnt = 3;
  let a = 1;
  let s2 = 0;
  let since = 0;
  for (let y = 0; y < h; y++) {
    // filter type 0 has code 00110000, reversed 00001100
    buf |= 12 << cnt;
    cnt += 8;
    s2 += a;
    const base = y * row;
    let i = 0;
    while (i < row) {
      const v = px[base + i];
      buf |= litBits[v] << cnt;
      cnt += litLen[v];
      a += v;
      s2 += a;
      i++;
      while (cnt >= 8) {
        out[o++] = buf & 255;
        buf >>>= 8;
        cnt -= 8;
      }
      // the same byte again: one copy covers up to 258 of them
      for (;;) {
        const n = sameBytes(px, words, base + i, Math.min(258, row - i), v);
        if (n < 3) break;
        buf |= (runBits[n] | (BACK_1 << runLen[n])) << cnt;
        cnt += runLen[n] + 5;
        s2 += n * a + (v * n * (n + 1)) / 2;
        a += v * n;
        i += n;
        since += n;
        while (cnt >= 8) {
          out[o++] = buf & 255;
          buf >>>= 8;
          cnt -= 8;
        }
      }
      // the same pixel again
      if (i >= 3) {
        for (;;) {
          let n = 0;
          while (n < 258 && i + n < row && px[base + i + n] === px[base + i + n - 3]) n++;
          if (n < 3) break;
          buf |= (runBits[n] | (BACK_3 << runLen[n])) << cnt;
          cnt += runLen[n] + 5;
          for (let k = 0; k < n; k++) {
            a += px[base + i + k];
            s2 += a;
          }
          i += n;
          since += n;
          while (cnt >= 8) {
            out[o++] = buf & 255;
            buf >>>= 8;
            cnt -= 8;
          }
        }
      }
      if (++since > 60000) {
        a %= 65521;
        s2 %= 65521;
        since = 0;
      }
    }
  }
  cnt += 7; // end of block, code 0000000
  while (cnt > 0) {
    out[o++] = buf & 255;
    buf >>>= 8;
    cnt -= 8;
  }
  a %= 65521;
  s2 %= 65521;
  out[o++] = s2 >>> 8;
  out[o++] = s2 & 255;
  out[o++] = a >>> 8;
  out[o++] = a & 255;
  return out.subarray(0, o);
}

function code(text: string, i: number): number {
  const c = text.charCodeAt(i);
  return c >= FIRST && c < FIRST + FONTS.r22.adv.length ? c : 63;
}

function kern(font: FontKey, pair: string): number {
  return (FONTS[font].kern as Record<string, number>)[pair] ?? 0;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}
