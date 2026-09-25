import Database from 'better-sqlite3';
import { env } from '../config/env.js';
import { migrations } from './schema.js';

export type Db = Database.Database;

let instance: Db | null = null;

export function db(): Db {
  if (instance) return instance;

  const connection = new Database(env.databaseFile);
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');

  connection.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     );`,
  );

  const applied = new Set(
    connection
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => (row as { id: string }).id),
  );

  const record = connection.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    connection.transaction(() => {
      connection.exec(migration.sql);
      record.run(migration.id, Date.now());
    })();
  }

  instance = connection;
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
