import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';

import { env } from '../config/env.js';
import { registerAdminRoutes } from './routes/admin/index.js';
import { registerProxyRoutes } from './routes/proxy.js';
import { upstreamKeysRepo } from '../db/repositories/upstreamKeys.js';
import { providersRepo } from '../db/repositories/providers.js';

/** Request bodies can carry base64 images, so the ceiling is generous. */
const BODY_LIMIT = 64 * 1024 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));

/** Locates the built dashboard whether running from `dist` or from `src`. */
function findWebRoot(): string | null {
  const candidates = [
    path.resolve(here, '../../../web/dist'),
    path.resolve(here, '../../web/dist'),
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, 'index.html'))) ?? null;
}

function isProxyPath(url: string | undefined): boolean {
  return Boolean(url && url.startsWith('/v1/'));
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.logLevel },
    bodyLimit: BODY_LIMIT,
    trustProxy: env.trustProxy,
    // Every proxied request is recorded in the activity log already; Fastify's
    // own per-request lines would only duplicate it.
    logController: new LogController({ disableRequestLogging: true }),
  });

  // Proxied requests keep their body as raw bytes so it is forwarded byte for
  // byte; dashboard requests get normal JSON parsing.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: BODY_LIMIT },
    (request, body, done) => {
      const buffer = body as Buffer;
      if (isProxyPath(request.url)) return done(null, buffer);
      if (!buffer || buffer.length === 0) return done(null, undefined);
      try {
        done(null, JSON.parse(buffer.toString('utf8')));
      } catch {
        const error = new Error('Request body is not valid JSON.') as Error & {
          statusCode?: number;
        };
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer', bodyLimit: BODY_LIMIT },
    (_request, body, done) => done(null, body),
  );

  await app.register(cookie);

  app.get('/health', async () => ({
    status: 'ok',
    service: 'tokenring',
    providers: providersRepo.count(),
    upstreamKeys: upstreamKeysRepo.list().filter((key) => key.enabled === 1).length,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  await app.register(registerProxyRoutes);
  await app.register(registerAdminRoutes);

  const webRoot = findWebRoot();
  if (webRoot) {
    // Served through a wildcard route rather than one route per file, so a
    // rebuilt bundle is picked up without restarting the proxy. Misses fall
    // through to the not-found handler below, which returns the SPA shell.
    await app.register(fastifyStatic, {
      root: webRoot,
      index: ['index.html'],
      maxAge: '1h',
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/v1/')) {
      return reply.code(404).send({
        error: {
          message: `No route for ${request.method} ${request.url}.`,
          type: 'invalid_request_error',
          code: 'not_found',
          param: null,
        },
      });
    }
    // Anything else is a dashboard deep link; hand back the SPA shell.
    if (webRoot) return reply.type('text/html').sendFile('index.html');
    return reply
      .code(404)
      .type('text/plain')
      .send('TokenRing dashboard is not built. Run `npm run build`.');
  });

  return app;
}
