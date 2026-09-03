import type { Request } from 'express';

export interface ApiKeyIdentity {
  id: string;
  name: string;
}

/** Express request after the request-ID middleware (and, past the guard, ApiKeyGuard) have run. */
export interface RouterRequest extends Request {
  requestId: string;
  apiKey?: ApiKeyIdentity;
}
