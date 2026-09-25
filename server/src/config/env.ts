import fs from 'node:fs';
import path from 'node:path';

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** Loads `.env` from the repo root without pulling in a dependency. */
function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

loadDotEnv();

const dataDir = path.resolve(str('TOKENRING_DATA_DIR', './data'));
fs.mkdirSync(dataDir, { recursive: true });

export const env = {
  host: str('TOKENRING_HOST', '0.0.0.0'),
  port: int('TOKENRING_PORT', 4000),
  publicUrl: str('TOKENRING_PUBLIC_URL', '').replace(/\/+$/, ''),

  dataDir,
  databaseFile: path.join(dataDir, 'tokenring.db'),
  masterKeyFile: path.join(dataDir, 'master.key'),

  encryptionKey: str('TOKENRING_ENCRYPTION_KEY', ''),
  adminPassword: str('TOKENRING_ADMIN_PASSWORD', ''),
  sessionTtlHours: int('TOKENRING_SESSION_TTL_HOURS', 24 * 7),

  defaultProviderName: str('TOKENRING_DEFAULT_PROVIDER_NAME', 'Default'),
  defaultProviderBaseUrl: str(
    'TOKENRING_DEFAULT_PROVIDER_BASE_URL',
    'https://api.openai.com/v1',
  ),

  logLevel: str('TOKENRING_LOG_LEVEL', 'info'),
  trustProxy: bool('TOKENRING_TRUST_PROXY', false),
  isProduction: str('NODE_ENV', 'development') === 'production',
} as const;
