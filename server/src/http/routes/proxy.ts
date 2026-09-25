import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { virtualKeysRepo } from '../../db/repositories/virtualKeys.js';
import { unauthorized } from '../../core/apiErrors.js';
import { runProxyRequest } from '../../core/proxyEngine.js';

/** Accepts the `Authorization: Bearer` header, plus the two vendor variants. */
function readClientToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1]!.trim();
  }
  const apiKeyHeader = request.headers['api-key'] ?? request.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) return apiKeyHeader.trim();
  return null;
}

function clientIp(request: FastifyRequest): string {
  if (env.trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (value) return value.split(',')[0]!.trim();
  }
  return request.ip;
}

export async function registerProxyRoutes(app: FastifyInstance): Promise<void> {
  app.all('/v1/*', async (request, reply) => {
    const token = readClientToken(request);
    if (!token) {
      const error = unauthorized(
        'Missing API key. Send it as "Authorization: Bearer <your TokenRing key>".',
        'missing_api_key',
      );
      return reply.code(error.status).send(error.toBody());
    }

    const virtualKey = virtualKeysRepo.findByToken(token);
    if (!virtualKey) {
      const error = unauthorized(
        'This API key is not registered with this TokenRing instance.',
        'invalid_api_key',
      );
      return reply.code(error.status).send(error.toBody());
    }

    const [path, search = ''] = request.url.split('?');

    // From here the raw Node response is driven directly so streamed replies
    // reach the client chunk by chunk, with no buffering in between.
    reply.hijack();
    await runProxyRequest(
      {
        method: request.method,
        path: path ?? request.url,
        search: search ? `?${search}` : '',
        headers: request.headers as Record<string, string | string[] | undefined>,
        body: (request.body as Buffer | undefined) ?? null,
        clientIp: clientIp(request),
        virtualKey,
      },
      reply.raw,
    );
  });
}
