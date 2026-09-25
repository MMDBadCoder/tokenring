import type {
  Overview,
  Provider,
  RequestLog,
  RuntimeSettings,
  UpstreamKey,
  VirtualKey,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      (payload as { error?: string | { message?: string } } | null)?.error &&
      typeof (payload as { error: string | { message?: string } }).error === 'object'
        ? ((payload as { error: { message?: string } }).error.message ?? 'Request failed.')
        : ((payload as { error?: string } | null)?.error ?? `Request failed (${response.status}).`);
    throw new ApiError(response.status, String(message));
  }
  return payload as T;
}

const body = (value: unknown): RequestInit => ({ body: JSON.stringify(value) });

export const api = {
  session: () => request<{ authenticated: boolean }>('/api/auth/session'),
  login: (password: string) =>
    request<{ authenticated: boolean }>('/api/auth/login', { method: 'POST', ...body({ password }) }),
  logout: () => request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ changed: boolean }>('/api/auth/password', {
      method: 'POST',
      ...body({ currentPassword, newPassword }),
    }),

  overview: (window: string) => request<Overview>(`/api/overview?window=${window}`),

  providers: () => request<{ providers: Provider[] }>('/api/providers'),
  createProvider: (input: Partial<Provider>) =>
    request<{ provider: Provider }>('/api/providers', { method: 'POST', ...body(input) }),
  updateProvider: (id: string, input: Partial<Provider>) =>
    request<{ provider: Provider }>(`/api/providers/${id}`, { method: 'PATCH', ...body(input) }),
  deleteProvider: (id: string) =>
    request<{ deleted: boolean }>(`/api/providers/${id}`, { method: 'DELETE' }),

  upstreamKeys: (window: string) =>
    request<{ keys: UpstreamKey[] }>(`/api/upstream-keys?window=${window}`),
  createUpstreamKey: (input: Record<string, unknown>) =>
    request<{ key: UpstreamKey }>('/api/upstream-keys', { method: 'POST', ...body(input) }),
  updateUpstreamKey: (id: string, input: Record<string, unknown>) =>
    request<{ key: UpstreamKey }>(`/api/upstream-keys/${id}`, { method: 'PATCH', ...body(input) }),
  deleteUpstreamKey: (id: string) =>
    request<{ deleted: boolean }>(`/api/upstream-keys/${id}`, { method: 'DELETE' }),
  resetUpstreamKey: (id: string) =>
    request<{ key: UpstreamKey }>(`/api/upstream-keys/${id}/reset`, { method: 'POST' }),
  testUpstreamKey: (id: string) =>
    request<{ ok: boolean; statusCode: number; latencyMs: number; models?: string[]; message: string }>(
      `/api/upstream-keys/${id}/test`,
      { method: 'POST' },
    ),

  virtualKeys: (window: string) =>
    request<{ keys: VirtualKey[] }>(`/api/virtual-keys?window=${window}`),
  createVirtualKey: (input: Record<string, unknown>) =>
    request<{ key: VirtualKey; token: string }>('/api/virtual-keys', { method: 'POST', ...body(input) }),
  updateVirtualKey: (id: string, input: Record<string, unknown>) =>
    request<{ key: VirtualKey }>(`/api/virtual-keys/${id}`, { method: 'PATCH', ...body(input) }),
  rotateVirtualKey: (id: string) =>
    request<{ key: VirtualKey; token: string }>(`/api/virtual-keys/${id}/rotate`, { method: 'POST' }),
  deleteVirtualKey: (id: string) =>
    request<{ deleted: boolean }>(`/api/virtual-keys/${id}`, { method: 'DELETE' }),

  logs: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    return request<{ logs: RequestLog[]; nextCursor: number | null; models: string[] }>(
      `/api/logs?${search.toString()}`,
    );
  },

  settings: () =>
    request<{ settings: RuntimeSettings; defaults: RuntimeSettings }>('/api/settings'),
  saveSettings: (input: Partial<RuntimeSettings>) =>
    request<{ settings: RuntimeSettings }>('/api/settings', { method: 'PATCH', ...body(input) }),
  pruneLogs: (days?: number) =>
    request<{ deleted: number }>('/api/logs/prune', { method: 'POST', ...body({ days }) }),
};
