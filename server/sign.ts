import { encodePiece, type Header, type Signed } from '../shared/pieces';

// The signing key comes from the GitHub token, so there is one secret to set instead of two.
// A new token only invalidates builds that are halfway through.
const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(token: string): Promise<CryptoKey> {
  let key = keys.get(token);
  if (!key) {
    key = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(`repo-replay pieces v1\n${token}`))
      .then((raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
    keys.set(token, key);
  }
  return key;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sign(token: string, header: Header, data: object = {}): Promise<Signed> {
  const body = encodePiece(header, data);
  const sig = await crypto.subtle.sign('HMAC', await keyFor(token), new TextEncoder().encode(body));
  return { body, sig: toHex(sig) };
}

export async function verify(token: string, signed: Signed): Promise<boolean> {
  if (typeof signed?.body !== 'string' || typeof signed?.sig !== 'string') return false;
  const sig = fromHex(signed.sig);
  if (!sig) return false;
  return crypto.subtle.verify('HMAC', await keyFor(token), sig, new TextEncoder().encode(signed.body));
}
