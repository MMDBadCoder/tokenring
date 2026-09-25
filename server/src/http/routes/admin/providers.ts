import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { providersRepo } from '../../../db/repositories/providers.js';
import { upstreamKeysRepo } from '../../../db/repositories/upstreamKeys.js';
import { serializeProvider } from '../../serializers.js';

const providerSchema = z.object({
  name: z.string().min(1, 'Give the provider a name.'),
  baseUrl: z.string().url('Enter a full URL, for example https://api.openai.com/v1'),
  isDefault: z.boolean().optional(),
});

export async function registerProviderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/providers', async () => ({
    providers: providersRepo.list().map(serializeProvider),
  }));

  app.post('/api/providers', async (request, reply) => {
    const parsed = providerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    const isFirst = providersRepo.count() === 0;
    const provider = providersRepo.create({
      ...parsed.data,
      isDefault: parsed.data.isDefault ?? isFirst,
    });
    return reply.code(201).send({ provider: serializeProvider(provider) });
  });

  app.patch('/api/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = providerSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    const provider = providersRepo.update(id, parsed.data);
    if (!provider) return reply.code(404).send({ error: 'Provider not found.' });
    return { provider: serializeProvider(provider) };
  });

  app.delete('/api/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const attached = upstreamKeysRepo.list().filter((key) => key.provider_id === id);
    if (attached.length > 0) {
      return reply.code(409).send({
        error: `This provider still holds ${attached.length} upstream key(s). Move or delete them first.`,
      });
    }
    if (providersRepo.list().length === 1) {
      return reply.code(409).send({ error: 'At least one provider must remain.' });
    }
    if (!providersRepo.remove(id)) return reply.code(404).send({ error: 'Provider not found.' });

    // Deleting the default leaves the pool without one; promote another.
    if (!providersRepo.list().some((provider) => provider.is_default === 1)) {
      const next = providersRepo.list()[0];
      if (next) providersRepo.setDefault(next.id);
    }
    return { deleted: true };
  });
}
