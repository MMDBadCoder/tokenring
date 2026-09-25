import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BALANCING_STRATEGIES,
  DEFAULT_SETTINGS,
  settingsRepo,
} from '../../../db/repositories/settings.js';
import { requestLogsRepo } from '../../../db/repositories/requestLogs.js';
import { DAY } from '../../../util/time.js';

const settingsSchema = z.object({
  strategy: z.enum(BALANCING_STRATEGIES).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  requestTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  rateLimitCooldownSeconds: z.number().int().min(0).max(3_600).optional(),
  failureCooldownSeconds: z.number().int().min(0).max(3_600).optional(),
  failureThreshold: z.number().int().min(1).max(20).optional(),
  disableOnAuthError: z.boolean().optional(),
  waitForCapacityMs: z.number().int().min(0).max(120_000).optional(),
  injectUsageTracking: z.boolean().optional(),
  estimateMissingTokens: z.boolean().optional(),
  forwardRateLimitHeaders: z.boolean().optional(),
  logRetentionDays: z.number().int().min(0).max(3_650).optional(),
});

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => ({
    settings: settingsRepo.all(),
    defaults: DEFAULT_SETTINGS,
  }));

  app.patch('/api/settings', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    return { settings: settingsRepo.save(parsed.data) };
  });

  app.post('/api/logs/prune', async (request) => {
    const { days } = (request.body ?? {}) as { days?: number };
    const retention = days ?? settingsRepo.all().logRetentionDays;
    if (!retention || retention <= 0) return { deleted: 0 };
    return { deleted: requestLogsRepo.prune(Date.now() - retention * DAY) };
  });
}
