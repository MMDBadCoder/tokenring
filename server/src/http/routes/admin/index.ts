import type { FastifyInstance } from 'fastify';
import { requireSession } from '../../auth.js';
import { registerAuthRoutes } from './auth.js';
import { registerProviderRoutes } from './providers.js';
import { registerUpstreamKeyRoutes } from './upstreamKeys.js';
import { registerVirtualKeyRoutes } from './virtualKeys.js';
import { registerInsightRoutes } from './insights.js';
import { registerSettingsRoutes } from './settings.js';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // Sign-in endpoints stay open; everything else is behind the session cookie.
  await app.register(registerAuthRoutes);

  await app.register(async (scope) => {
    scope.addHook('preHandler', requireSession);
    await scope.register(registerProviderRoutes);
    await scope.register(registerUpstreamKeyRoutes);
    await scope.register(registerVirtualKeyRoutes);
    await scope.register(registerInsightRoutes);
    await scope.register(registerSettingsRoutes);
  });
}
