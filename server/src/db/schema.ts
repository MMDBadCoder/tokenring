/**
 * Schema migrations, applied in order. Each entry runs exactly once and is
 * recorded in `schema_migrations`, so adding a new one is always safe.
 */
export const migrations: { id: string; sql: string }[] = [
  {
    id: '001_initial',
    sql: `
      CREATE TABLE providers (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        base_url      TEXT NOT NULL,
        is_default    INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      -- Real keys issued by the upstream LLM provider, pooled across the team.
      CREATE TABLE upstream_keys (
        id                   TEXT PRIMARY KEY,
        provider_id          TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        label                TEXT NOT NULL,
        owner                TEXT NOT NULL DEFAULT '',
        secret_encrypted     TEXT NOT NULL,
        secret_hint          TEXT NOT NULL,
        rpm_limit            INTEGER NOT NULL DEFAULT 0,
        tpm_limit            INTEGER NOT NULL DEFAULT 0,
        daily_request_limit  INTEGER NOT NULL DEFAULT 0,
        weight               INTEGER NOT NULL DEFAULT 1,
        enabled              INTEGER NOT NULL DEFAULT 1,
        notes                TEXT NOT NULL DEFAULT '',
        cooldown_until       INTEGER NOT NULL DEFAULT 0,
        cooldown_reason      TEXT NOT NULL DEFAULT '',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_used_at         INTEGER NOT NULL DEFAULT 0,
        last_error           TEXT NOT NULL DEFAULT '',
        last_error_at        INTEGER NOT NULL DEFAULT 0,
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL
      );
      CREATE INDEX idx_upstream_keys_provider ON upstream_keys(provider_id);

      -- Keys TokenRing issues to teammates and agents. Only the hash is stored.
      CREATE TABLE virtual_keys (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        owner               TEXT NOT NULL DEFAULT '',
        key_hash            TEXT NOT NULL UNIQUE,
        key_hint            TEXT NOT NULL,
        enabled             INTEGER NOT NULL DEFAULT 1,
        rpm_limit           INTEGER NOT NULL DEFAULT 0,
        daily_request_limit INTEGER NOT NULL DEFAULT 0,
        daily_token_limit   INTEGER NOT NULL DEFAULT 0,
        allowed_models      TEXT NOT NULL DEFAULT '',
        provider_id         TEXT REFERENCES providers(id) ON DELETE SET NULL,
        expires_at          INTEGER NOT NULL DEFAULT 0,
        notes               TEXT NOT NULL DEFAULT '',
        last_used_at        INTEGER NOT NULL DEFAULT 0,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      );
      CREATE INDEX idx_virtual_keys_hash ON virtual_keys(key_hash);

      -- One row per proxied request, the source of truth for all usage stats.
      CREATE TABLE request_logs (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at        INTEGER NOT NULL,
        virtual_key_id    TEXT,
        upstream_key_id   TEXT,
        provider_id       TEXT,
        method            TEXT NOT NULL,
        path              TEXT NOT NULL,
        model             TEXT NOT NULL DEFAULT '',
        status_code       INTEGER NOT NULL DEFAULT 0,
        succeeded         INTEGER NOT NULL DEFAULT 0,
        streamed          INTEGER NOT NULL DEFAULT 0,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens      INTEGER NOT NULL DEFAULT 0,
        token_source      TEXT NOT NULL DEFAULT 'none',
        latency_ms        INTEGER NOT NULL DEFAULT 0,
        ttfb_ms           INTEGER NOT NULL DEFAULT 0,
        attempts          INTEGER NOT NULL DEFAULT 1,
        error_kind        TEXT NOT NULL DEFAULT '',
        error_message     TEXT NOT NULL DEFAULT '',
        client_ip         TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_logs_created ON request_logs(created_at DESC);
      CREATE INDEX idx_logs_virtual_key ON request_logs(virtual_key_id, created_at DESC);
      CREATE INDEX idx_logs_upstream_key ON request_logs(upstream_key_id, created_at DESC);

      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];
