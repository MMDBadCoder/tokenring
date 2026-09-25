import { db } from '../database.js';
import type { UpstreamKeyRow } from '../types.js';
import { newId } from '../../util/ids.js';
import { encryptSecret, maskSecret } from '../../util/secrets.js';

export interface UpstreamKeyInput {
  providerId: string;
  label: string;
  owner?: string;
  secret?: string;
  rpmLimit?: number;
  tpmLimit?: number;
  dailyRequestLimit?: number;
  weight?: number;
  enabled?: boolean;
  notes?: string;
}

export const upstreamKeysRepo = {
  list(): UpstreamKeyRow[] {
    return db()
      .prepare('SELECT * FROM upstream_keys ORDER BY created_at ASC')
      .all() as UpstreamKeyRow[];
  },

  listUsable(providerId: string): UpstreamKeyRow[] {
    return db()
      .prepare(
        'SELECT * FROM upstream_keys WHERE provider_id = ? AND enabled = 1 ORDER BY created_at ASC',
      )
      .all(providerId) as UpstreamKeyRow[];
  },

  get(id: string): UpstreamKeyRow | undefined {
    return db().prepare('SELECT * FROM upstream_keys WHERE id = ?').get(id) as
      | UpstreamKeyRow
      | undefined;
  },

  create(input: UpstreamKeyInput): UpstreamKeyRow {
    if (!input.secret) throw new Error('An upstream key needs a secret.');
    const id = newId('up');
    const timestamp = Date.now();
    db()
      .prepare(
        `INSERT INTO upstream_keys
           (id, provider_id, label, owner, secret_encrypted, secret_hint, rpm_limit,
            tpm_limit, daily_request_limit, weight, enabled, notes, created_at, updated_at)
         VALUES
           (@id, @provider_id, @label, @owner, @secret_encrypted, @secret_hint, @rpm_limit,
            @tpm_limit, @daily_request_limit, @weight, @enabled, @notes, @created_at, @updated_at)`,
      )
      .run({
        id,
        provider_id: input.providerId,
        label: input.label.trim(),
        owner: input.owner?.trim() ?? '',
        secret_encrypted: encryptSecret(input.secret.trim()),
        secret_hint: maskSecret(input.secret.trim()),
        rpm_limit: Math.max(0, input.rpmLimit ?? 0),
        tpm_limit: Math.max(0, input.tpmLimit ?? 0),
        daily_request_limit: Math.max(0, input.dailyRequestLimit ?? 0),
        weight: Math.max(1, input.weight ?? 1),
        enabled: input.enabled === false ? 0 : 1,
        notes: input.notes?.trim() ?? '',
        created_at: timestamp,
        updated_at: timestamp,
      });
    return upstreamKeysRepo.get(id)!;
  },

  update(id: string, input: Partial<UpstreamKeyInput>): UpstreamKeyRow | undefined {
    const existing = upstreamKeysRepo.get(id);
    if (!existing) return undefined;

    const secret = input.secret?.trim();
    db()
      .prepare(
        `UPDATE upstream_keys SET
           provider_id = @provider_id,
           label = @label,
           owner = @owner,
           secret_encrypted = @secret_encrypted,
           secret_hint = @secret_hint,
           rpm_limit = @rpm_limit,
           tpm_limit = @tpm_limit,
           daily_request_limit = @daily_request_limit,
           weight = @weight,
           enabled = @enabled,
           notes = @notes,
           updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id,
        provider_id: input.providerId ?? existing.provider_id,
        label: input.label?.trim() ?? existing.label,
        owner: input.owner?.trim() ?? existing.owner,
        secret_encrypted: secret ? encryptSecret(secret) : existing.secret_encrypted,
        secret_hint: secret ? maskSecret(secret) : existing.secret_hint,
        rpm_limit: input.rpmLimit ?? existing.rpm_limit,
        tpm_limit: input.tpmLimit ?? existing.tpm_limit,
        daily_request_limit: input.dailyRequestLimit ?? existing.daily_request_limit,
        weight: input.weight ?? existing.weight,
        enabled: input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
        notes: input.notes ?? existing.notes,
        updated_at: Date.now(),
      });

    // A fresh secret or a manual re-enable clears any quarantine.
    if (secret || input.enabled === true) upstreamKeysRepo.clearCooldown(id);
    return upstreamKeysRepo.get(id);
  },

  remove(id: string): boolean {
    return db().prepare('DELETE FROM upstream_keys WHERE id = ?').run(id).changes > 0;
  },

  markUsed(id: string, at: number): void {
    db().prepare('UPDATE upstream_keys SET last_used_at = ? WHERE id = ?').run(at, id);
  },

  markSuccess(id: string): void {
    db()
      .prepare(
        `UPDATE upstream_keys
         SET consecutive_failures = 0, cooldown_until = 0, cooldown_reason = ''
         WHERE id = ?`,
      )
      .run(id);
  },

  markFailure(id: string, cooldownUntil: number, reason: string, message: string): void {
    db()
      .prepare(
        `UPDATE upstream_keys SET
           consecutive_failures = consecutive_failures + 1,
           cooldown_until = MAX(cooldown_until, @cooldown_until),
           cooldown_reason = @reason,
           last_error = @message,
           last_error_at = @at
         WHERE id = @id`,
      )
      .run({ id, cooldown_until: cooldownUntil, reason, message: message.slice(0, 500), at: Date.now() });
  },

  disable(id: string, reason: string, message: string): void {
    db()
      .prepare(
        `UPDATE upstream_keys SET
           enabled = 0,
           cooldown_reason = @reason,
           last_error = @message,
           last_error_at = @at,
           updated_at = @at
         WHERE id = @id`,
      )
      .run({ id, reason, message: message.slice(0, 500), at: Date.now() });
  },

  clearCooldown(id: string): void {
    db()
      .prepare(
        `UPDATE upstream_keys
         SET cooldown_until = 0, cooldown_reason = '', consecutive_failures = 0
         WHERE id = ?`,
      )
      .run(id);
  },
};
