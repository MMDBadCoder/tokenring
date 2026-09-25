export interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface UpstreamKeyRow {
  id: string;
  provider_id: string;
  label: string;
  owner: string;
  secret_encrypted: string;
  secret_hint: string;
  rpm_limit: number;
  tpm_limit: number;
  daily_request_limit: number;
  weight: number;
  enabled: number;
  notes: string;
  cooldown_until: number;
  cooldown_reason: string;
  consecutive_failures: number;
  last_used_at: number;
  last_error: string;
  last_error_at: number;
  created_at: number;
  updated_at: number;
}

export interface VirtualKeyRow {
  id: string;
  name: string;
  owner: string;
  key_hash: string;
  key_hint: string;
  enabled: number;
  rpm_limit: number;
  daily_request_limit: number;
  daily_token_limit: number;
  allowed_models: string;
  provider_id: string | null;
  expires_at: number;
  notes: string;
  last_used_at: number;
  created_at: number;
  updated_at: number;
}

export interface RequestLogRow {
  id: number;
  created_at: number;
  virtual_key_id: string | null;
  upstream_key_id: string | null;
  provider_id: string | null;
  method: string;
  path: string;
  model: string;
  status_code: number;
  succeeded: number;
  streamed: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  token_source: string;
  latency_ms: number;
  ttfb_ms: number;
  attempts: number;
  error_kind: string;
  error_message: string;
  client_ip: string;
}
