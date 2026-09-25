import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';

function loadMasterKey(): Buffer {
  if (env.encryptionKey) {
    const raw = env.encryptionKey.trim();
    const decoded = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    if (decoded.length !== 32) {
      throw new Error(
        'TOKENRING_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or 44 base64 chars).',
      );
    }
    return decoded;
  }

  if (fs.existsSync(env.masterKeyFile)) {
    return Buffer.from(fs.readFileSync(env.masterKeyFile, 'utf8').trim(), 'hex');
  }

  const generated = randomBytes(32);
  fs.writeFileSync(env.masterKeyFile, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

let masterKey: Buffer | null = null;
function key(): Buffer {
  masterKey ??= loadMasterKey();
  return masterKey;
}

/** Encrypts a secret for storage. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) {
    throw new Error('Stored secret is malformed or was encrypted with a different key.');
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Deterministic lookup hash — virtual keys are looked up by this, never by plaintext. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt.${salt}.${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split('.');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Shows enough of a secret to recognise it, never enough to use it. */
export function maskSecret(secret: string): string {
  if (secret.length <= 12) return `${secret.slice(0, 2)}…${secret.slice(-2)}`;
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}
