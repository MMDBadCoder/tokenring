import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { virtualKeysRepo } from '../../../db/repositories/virtualKeys.js';
import { statsRepo } from '../../../db/repositories/stats.js';
import { usageWindows } from '../../../core/usageWindows.js';
import { parseWindow } from '../../../util/time.js';
import { EMPTY_USAGE, serializeVirtualKey } from '../../serializers.js';

const createSchema = z.object({
  name: z.string().min(1, 'Give the key a name, such as the person or agent using it.'),
  owner: z.string().optional(),
  enabled: z.boolean().optional(),
  rpmLimit: z.number().int().min(0).optional(),
  dailyRequestLimit: z.number().int().min(0).optional(),
  dailyTokenLimit: z.number().int().min(0).optional(),
  allowedModels: z.array(z.string()).optional(),
  providerId: z.string().nullable().optional(),
  expiresAt: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export async function registerVirtualKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/virtual-keys', async (request) => {
    const { window } = request.query as { window?: string };
    const to = Date.now();
    const from = to - parseWindow(window);
    const usage = new Map(statsRepo.byVirtualKey(from, to).map((row) => [row.id, row]));

    return {
      keys: virtualKeysRepo.list().map((row) =>
        serializeVirtualKey(row, {
          usage: usage.get(row.id) ?? EMPTY_USAGE,
          requestsUsed: usageWindows.requestsInWindow(row.id, to),
          tokensToday: usageWindows.tokensToday(row.id, to),
        }),
      ),
    };
  });

  app.post('/api/virtual-keys', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    const { row, token } = virtualKeysRepo.create(parsed.data);
    // `token` is returned exactly once — only its hash is stored.
    return reply.code(201).send({ key: serializeVirtualKey(row), token });
  });

  app.patch('/api/virtual-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    const row = virtualKeysRepo.update(id, parsed.data);
    if (!row) return reply.code(404).send({ error: 'Key not found.' });
    return { key: serializeVirtualKey(row) };
  });

  app.post('/api/virtual-keys/:id/rotate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rotated = virtualKeysRepo.rotate(id);
    if (!rotated) return reply.code(404).send({ error: 'Key not found.' });
    return { key: serializeVirtualKey(rotated.row), token: rotated.token };
  });

  app.delete('/api/virtual-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!virtualKeysRepo.remove(id)) return reply.code(404).send({ error: 'Key not found.' });
    usageWindows.forget(id);
    return { deleted: true };
  });
}
