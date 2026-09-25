import { db } from '../database.js';
import type { ProviderRow } from '../types.js';
import { newId } from '../../util/ids.js';

export interface ProviderInput {
  name: string;
  baseUrl: string;
  isDefault?: boolean;
}

function normaliseBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export const providersRepo = {
  list(): ProviderRow[] {
    return db()
      .prepare('SELECT * FROM providers ORDER BY is_default DESC, name ASC')
      .all() as ProviderRow[];
  },

  get(id: string): ProviderRow | undefined {
    return db().prepare('SELECT * FROM providers WHERE id = ?').get(id) as
      | ProviderRow
      | undefined;
  },

  getDefault(): ProviderRow | undefined {
    return db()
      .prepare('SELECT * FROM providers ORDER BY is_default DESC, created_at ASC LIMIT 1')
      .get() as ProviderRow | undefined;
  },

  create(input: ProviderInput): ProviderRow {
    const id = newId('prv');
    const timestamp = Date.now();
    db()
      .prepare(
        `INSERT INTO providers (id, name, base_url, is_default, created_at, updated_at)
         VALUES (@id, @name, @base_url, @is_default, @created_at, @updated_at)`,
      )
      .run({
        id,
        name: input.name.trim(),
        base_url: normaliseBaseUrl(input.baseUrl),
        is_default: input.isDefault ? 1 : 0,
        created_at: timestamp,
        updated_at: timestamp,
      });
    if (input.isDefault) providersRepo.setDefault(id);
    return providersRepo.get(id)!;
  },

  update(id: string, input: Partial<ProviderInput>): ProviderRow | undefined {
    const existing = providersRepo.get(id);
    if (!existing) return undefined;
    db()
      .prepare('UPDATE providers SET name = ?, base_url = ?, updated_at = ? WHERE id = ?')
      .run(
        input.name?.trim() ?? existing.name,
        input.baseUrl ? normaliseBaseUrl(input.baseUrl) : existing.base_url,
        Date.now(),
        id,
      );
    if (input.isDefault) providersRepo.setDefault(id);
    return providersRepo.get(id);
  },

  setDefault(id: string): void {
    const connection = db();
    connection.transaction(() => {
      connection.prepare('UPDATE providers SET is_default = 0').run();
      connection.prepare('UPDATE providers SET is_default = 1 WHERE id = ?').run(id);
    })();
  },

  remove(id: string): boolean {
    return db().prepare('DELETE FROM providers WHERE id = ?').run(id).changes > 0;
  },

  count(): number {
    const row = db().prepare('SELECT COUNT(*) AS n FROM providers').get() as { n: number };
    return row.n;
  },
};
