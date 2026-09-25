import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { settingsRepo } from '../db/repositories/settings.js';
import { randomBase62 } from '../util/ids.js';
import { hashPassword, verifyPassword } from '../util/secrets.js';
import { HOUR } from '../util/time.js';

export const SESSION_COOKIE = 'tokenring_session';

const sessions = new Map<string, number>();

/**
 * Ensures a dashboard password exists. Uses TOKENRING_ADMIN_PASSWORD when set,
 * otherwise generates one on first boot and returns it so it can be shown once.
 */
export function ensureAdminPassword(): { generated: string | null } {
  const stored = settingsRepo.getInternal('adminPasswordHash');

  if (env.adminPassword) {
    if (!stored || !verifyPassword(env.adminPassword, stored)) {
      settingsRepo.setInternal('adminPasswordHash', hashPassword(env.adminPassword));
    }
    return { generated: null };
  }

  if (stored) return { generated: null };

  const generated = randomBase62(20);
  settingsRepo.setInternal('adminPasswordHash', hashPassword(generated));
  return { generated };
}

export function changeAdminPassword(current: string, next: string): boolean {
  const stored = settingsRepo.getInternal('adminPasswordHash');
  if (!stored || !verifyPassword(current, stored)) return false;
  settingsRepo.setInternal('adminPasswordHash', hashPassword(next));
  sessions.clear();
  return true;
}

export function login(password: string): string | null {
  const stored = settingsRepo.getInternal('adminPasswordHash');
  if (!stored || !verifyPassword(password, stored)) return null;
  const token = randomBase62(48);
  sessions.set(token, Date.now() + env.sessionTtlHours * HOUR);
  return token;
}

export function logout(token: string | undefined): void {
  if (token) sessions.delete(token);
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.isProduction,
    maxAge: env.sessionTtlHours * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Fastify preHandler that gates every dashboard API route. */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (isValidSession(token)) return;
  await reply.code(401).send({ error: 'Not signed in.' });
}
