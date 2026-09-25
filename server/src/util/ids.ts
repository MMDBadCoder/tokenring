import { randomBytes, randomUUID } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Cryptographically secure base62 string of the requested length. */
export function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      // Reject values that would bias the modulo (256 % 62 = 8 leftover).
      if (byte >= 248) continue;
      out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}
