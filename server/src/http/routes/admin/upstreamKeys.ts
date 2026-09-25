import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { providersRepo } from '../../../db/repositories/providers.js';
import { upstreamKeysRepo } from '../../../db/repositories/upstreamKeys.js';
import { statsRepo } from '../../../db/repositories/stats.js';
import { settingsRepo } from '../../../db/repositories/settings.js';
import { usageWindows } from '../../../core/usageWindows.js';
import { buildUpstreamUrl } from '../../../core/upstreamClient.js';
import { decryptSecret } from '../../../util/secrets.js';
import { parseWindow } from '../../../util/time.js';
import { EMPTY_USAGE, serializeUpstreamKey } from '../../serializers.js';

const createSchema = z.object({
  providerId: z.string().min(1).optional(),
  label: z.string().min(1, 'Give the key a label so you can recognise it.'),
  owner: z.string().optional(),
  secret: z.string().min(8, 'That does not look like an API key.'),
  rpmLimit: z.number().int().min(0).optional(),
  tpmLimit: z.number().int().min(0).optional(),
  dailyRequestLimit: z.number().int().min(0).optional(),
  weight: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  notes: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  secret: z.string().min(8).optional(),
});

export async function registerUpstreamKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/upstream-keys', async (request) => {
    const { window } = request.query as { window?: string };
    const to = Date.now();
    const from = to - parseWindow(window);

    const providers = new Map(providersRepo.list().map((row) => [row.id, row.name]));
    const usage = new Map(statsRepo.byUpstreamKey(from, to).map((row) => [row.id, row]));

    return {
      keys: upstreamKeysRepo.list().map((row) =>
        serializeUpstreamKey(row, {
          providerName: providers.get(row.provider_id) ?? 'Unknown provider',
          usage: usage.get(row.id) ?? EMPTY_USAGE,
          at: to,
        }),
      ),
    };
  });

  app.post('/api/upstream-keys', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    const providerId = parsed.data.providerId ?? providersRepo.getDefault()?.id;
    if (!providerId) {
      return reply.code(400).send({ error: 'Add a provider before adding upstream keys.' });
    }
    const key = upstreamKeysRepo.create({ ...parsed.data, providerId });
    return reply.code(201).send({ key: serializeUpstreamKey(key) });
  });

  app.patch('/api/upstream-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    const key = upstreamKeysRepo.update(id, parsed.data);
    if (!key) return reply.code(404).send({ error: 'Upstream key not found.' });
    return { key: serializeUpstreamKey(key) };
  });

  app.delete('/api/upstream-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!upstreamKeysRepo.remove(id)) {
      return reply.code(404).send({ error: 'Upstream key not found.' });
    }
    usageWindows.forget(id);
    return { deleted: true };
  });

  /** Lifts a quarantine early, after the owner has fixed whatever broke. */
  app.post('/api/upstream-keys/:id/reset', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = upstreamKeysRepo.get(id);
    if (!existing) return reply.code(404).send({ error: 'Upstream key not found.' });
    upstreamKeysRepo.clearCooldown(id);
    return { key: serializeUpstreamKey(upstreamKeysRepo.get(id)!) };
  });

  /** Verifies a key against the live provider by listing models. */
  app.post('/api/upstream-keys/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const key = upstreamKeysRepo.get(id);
    if (!key) return reply.code(404).send({ error: 'Upstream key not found.' });

    const provider = providersRepo.get(key.provider_id);
    if (!provider) return reply.code(400).send({ error: 'This key has no provider.' });

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(settingsRepo.all().requestTimeoutMs, 20_000),
    );

    try {
      const response = await fetch(buildUpstreamUrl(provider.base_url, '/v1/models', ''), {
        headers: { authorization: `Bearer ${decryptSecret(key.secret_encrypted)}` },
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        return {
          ok: false,
          statusCode: response.status,
          latencyMs,
          message: `Provider replied ${response.status}. ${detail}`.trim(),
        };
      }

      const payload = (await response.json()) as { data?: { id?: string }[] };
      const models = (payload.data ?? []).map((entry) => entry.id).filter(Boolean) as string[];
      upstreamKeysRepo.clearCooldown(id);
      return {
        ok: true,
        statusCode: response.status,
        latencyMs,
        models: models.slice(0, 50),
        message: `Key works. ${models.length} model(s) available.`,
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: 0,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  });
}
