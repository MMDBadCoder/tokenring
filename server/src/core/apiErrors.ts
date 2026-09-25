/** Error payloads mirror the upstream's shape so existing clients parse them. */
export interface ApiErrorBody {
  error: {
    message: string;
    type: string;
    code: string;
    param: null;
  };
}

export class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly code: string,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProxyError';
  }

  toBody(): ApiErrorBody {
    return {
      error: { message: this.message, type: this.type, code: this.code, param: null },
    };
  }
}

export function unauthorized(message: string, code = 'invalid_api_key'): ProxyError {
  return new ProxyError(401, 'invalid_request_error', code, message);
}

export function forbidden(message: string, code: string): ProxyError {
  return new ProxyError(403, 'invalid_request_error', code, message);
}

export function rateLimited(message: string, code: string, retryAfterMs: number): ProxyError {
  return new ProxyError(429, 'rate_limit_error', code, message, retryAfterMs);
}

export function badGateway(message: string, code: string): ProxyError {
  return new ProxyError(502, 'api_error', code, message);
}

export function serviceUnavailable(message: string, code: string): ProxyError {
  return new ProxyError(503, 'api_error', code, message);
}
