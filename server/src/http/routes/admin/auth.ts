import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  changeAdminPassword,
  clearSessionCookie,
  isValidSession,
  login,
  logout,
  setSessionCookie,
} from '../../auth.js';

const loginSchema = z.object({ password: z.string().min(1) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Use at least 8 characters.'),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/session', async (request) => ({
    authenticated: isValidSession(request.cookies[SESSION_COOKIE]),
  }));

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A password is required.' });

    const token = login(parsed.data.password);
    if (!token) return reply.code(401).send({ error: 'That password is not correct.' });

    setSessionCookie(reply, token);
    return { authenticated: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    logout(request.cookies[SESSION_COOKIE]);
    clearSessionCookie(reply);
    return { authenticated: false };
  });

  app.post('/api/auth/password', async (request, reply) => {
    if (!isValidSession(request.cookies[SESSION_COOKIE])) {
      return reply.code(401).send({ error: 'Not signed in.' });
    }
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    }
    const changed = changeAdminPassword(parsed.data.currentPassword, parsed.data.newPassword);
    if (!changed) return reply.code(401).send({ error: 'Current password is not correct.' });

    clearSessionCookie(reply);
    return { changed: true };
  });
}
