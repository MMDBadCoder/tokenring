import { env } from './config/env.js';
import { db, closeDb } from './db/database.js';
import { providersRepo } from './db/repositories/providers.js';
import { requestLogsRepo } from './db/repositories/requestLogs.js';
import { settingsRepo } from './db/repositories/settings.js';
import { usageWindows } from './core/usageWindows.js';
import { ensureAdminPassword } from './http/auth.js';
import { buildApp } from './http/app.js';
import { DAY, HOUR } from './util/time.js';

const BANNER = [
  '',
  '  ┌───────────────────────────────────────────┐',
  '  │  TokenRing · OpenAI-compatible key pool   │',
  '  └───────────────────────────────────────────┘',
  '',
].join('\n');

function seedDefaultProvider(): void {
  if (providersRepo.count() > 0) return;
  providersRepo.create({
    name: env.defaultProviderName,
    baseUrl: env.defaultProviderBaseUrl,
    isDefault: true,
  });
}

/** Deletes request history past the configured retention window. */
function pruneLogs(): void {
  const { logRetentionDays } = settingsRepo.all();
  if (logRetentionDays > 0) {
    requestLogsRepo.prune(Date.now() - logRetentionDays * DAY);
  }
}

async function start(): Promise<void> {
  db();
  seedDefaultProvider();
  const { generated } = ensureAdminPassword();
  usageWindows.hydrate();
  pruneLogs();

  const app = await buildApp();
  await app.listen({ host: env.host, port: env.port });

  const url = env.publicUrl || `http://localhost:${env.port}`;
  app.log.info(`Dashboard      ${url}`);
  app.log.info(`OpenAI base URL ${url}/v1`);

  if (generated) {
    app.log.warn(
      `Dashboard password (shown once, stored hashed): ${generated}\n` +
        '  Set TOKENRING_ADMIN_PASSWORD to choose your own, or change it in Settings.',
    );
  }

  const pruneTimer = setInterval(pruneLogs, 6 * HOUR);
  pruneTimer.unref();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info(`${signal} received, shutting down.`);
      void app.close().then(() => {
        closeDb();
        process.exit(0);
      });
    });
  }
}

console.log(BANNER);
start().catch((error) => {
  console.error('TokenRing failed to start:', error);
  process.exit(1);
});
