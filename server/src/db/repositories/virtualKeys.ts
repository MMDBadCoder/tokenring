import { db } from '../database.js';
import type { VirtualKeyRow } from '../types.js';
import { newId, randomBase62 } from '../../util/ids.js';
import { hashToken } from '../../util/secrets.js';

/**
 * Virtual keys keep the `sk-` prefix because many OpenAI client libraries
 * validate it before a request ever leaves the machine.
 */
export const VIRTUAL_KEY_PREFIX = 'sk-ring-';

export interface VirtualKeyInput {
  name: string;
  owner?: string;
  enabled?: boolean;
  rpmLimit?: number;
  dailyRequestLimit?: number;
  dailyTokenLimit?: number;
  allowedModels?: string[];
  providerId?: string | null;
  expiresAt?: number;
  notes?: string;
}

export function generateVirtualKey(): string {
  return `${VIRTUAL_KEY_PREFIX}${randomBase62(40)}`;
}

function hint(token: string): string {
  return `${token.slice(0, VIRTUAL_KEY_PREFIX.length + 4)}…${token.slice(-4)}`;
}

export const virtualKeysRepo = {
  list(): VirtualKeyRow[] {
    return db()
      .prepare('SELECT * FROM virtual_keys ORDER BY created_at DESC')
      .all() as VirtualKeyRow[];
  },

  get(id: string): VirtualKeyRow | undefined {
    return db().prepare('SELECT * FROM virtual_keys WHERE id = ?').get(id) as
      | VirtualKeyRow
      | undefined;
  },

  findByToken(token: string): VirtualKeyRow | undefined {
    return db()
      .prepare('SELECT * FROM virtual_keys WHERE key_hash = ?')
      .get(hashToken(token)) as VirtualKeyRow | undefined;
  },

  /** Returns the row plus the plaintext token, which is never recoverable later. */
  create(input: VirtualKeyInput): { row: VirtualKeyRow; token: string } {
    const token = generateVirtualKey();
    const id = newId('vk');
    const timestamp = Date.now();
    db()
      .prepare(
        `INSERT INTO virtual_keys
           (id, name, owner, key_hash, key_hint, enabled, rpm_limit, daily_request_limit,
            daily_token_limit, allowed_models, provider_id, expires_at, notes, created_at, updated_at)
         VALUES
           (@id, @name, @owner, @key_hash, @key_hint, @enabled, @rpm_limit, @daily_request_limit,
            @daily_token_limit, @allowed_models, @provider_id, @expires_at, @notes, @created_at, @updated_at)`,
      )
      .run({
        id,
        name: input.name.trim(),
        owner: input.owner?.trim() ?? '',
        key_hash: hashToken(token),
        key_hint: hint(token),
        enabled: input.enabled === false ? 0 : 1,
        rpm_limit: Math.max(0, input.rpmLimit ?? 0),
        daily_request_limit: Math.max(0, input.dailyRequestLimit ?? 0),
        daily_token_limit: Math.max(0, input.dailyTokenLimit ?? 0),
        allowed_models: (input.allowedModels ?? []).join(','),
        provider_id: input.providerId ?? null,
        expires_at: input.expiresAt ?? 0,
        notes: input.notes?.trim() ?? '',
        created_at: timestamp,
        updated_at: timestamp,
      });
    return { row: virtualKeysRepo.get(id)!, token };
  },

  update(id: string, input: Partial<VirtualKeyInput>): VirtualKeyRow | undefined {
    const existing = virtualKeysRepo.get(id);
    if (!existing) return undefined;
    db()
      .prepare(
        `UPDATE virtual_keys SET
           name = @name,
           owner = @owner,
           enabled = @enabled,
           rpm_limit = @rpm_limit,
           daily_request_limit = @daily_request_limit,
           daily_token_limit = @daily_token_limit,
           allowed_models = @allowed_models,
           provider_id = @provider_id,
           expires_at = @expires_at,
           notes = @notes,
           updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id,
        name: input.name?.trim() ?? existing.name,
        owner: input.owner?.trim() ?? existing.owner,
        enabled: input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
        rpm_limit: input.rpmLimit ?? existing.rpm_limit,
        daily_request_limit: input.dailyRequestLimit ?? existing.daily_request_limit,
        daily_token_limit: input.dailyTokenLimit ?? existing.daily_token_limit,
        allowed_models: input.allowedModels
          ? input.allowedModels.join(',')
          : existing.allowed_models,
        provider_id: input.providerId === undefined ? existing.provider_id : input.providerId,
        expires_at: input.expiresAt ?? existing.expires_at,
        notes: input.notes ?? existing.notes,
        updated_at: Date.now(),
      });
    return virtualKeysRepo.get(id);
  },

  /** Issues a new token for an existing key; the old token stops working at once. */
  rotate(id: string): { row: VirtualKeyRow; token: string } | undefined {
    const existing = virtualKeysRepo.get(id);
    if (!existing) return undefined;
    const token = generateVirtualKey();
    db()
      .prepare('UPDATE virtual_keys SET key_hash = ?, key_hint = ?, updated_at = ? WHERE id = ?')
      .run(hashToken(token), hint(token), Date.now(), id);
    return { row: virtualKeysRepo.get(id)!, token };
  },

  remove(id: string): boolean {
    return db().prepare('DELETE FROM virtual_keys WHERE id = ?').run(id).changes > 0;
  },

  markUsed(id: string, at: number): void {
    db().prepare('UPDATE virtual_keys SET last_used_at = ? WHERE id = ?').run(at, id);
  },
};
