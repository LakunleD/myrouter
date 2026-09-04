import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';

interface ErrorLike {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  name?: unknown;
  cause?: unknown;
  type?: unknown;
}

const CONNECTION_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Thrown by the OpenAI and Anthropic SDKs when their own request timeout fires. */
const TIMEOUT_NAMES = new Set(['APIConnectionTimeoutError']);
const CONNECTION_NAMES = new Set(['APIConnectionError', 'FetchError']);

/**
 * An upstream stream that closed without its terminal event (finish reason,
 * stop reason) was cut off, not completed. Retryable: before the first chunk it
 * triggers fallback; after commit it becomes an SSE error frame instead of [DONE].
 */
export function truncatedStream(provider: string): RouterError {
  return new RouterError(ErrorCode.PROVIDER_UNAVAILABLE, 'Upstream stream ended before completion', { provider });
}

/** Maps SDK/HTTP failures into the router's provider-neutral error vocabulary. */
export function mapProviderError(error: unknown): RouterError {
  if (error instanceof RouterError) return error;

  const candidate = asErrorLike(error);
  const status = numeric(candidate.status) ?? numeric(candidate.statusCode);
  const options = { upstreamStatus: status, cause: error };

  if (status === 400 || status === 422) {
    return new RouterError(ErrorCode.INVALID_REQUEST, 'Upstream provider rejected the request', options);
  }
  if (status === 404) return new RouterError(ErrorCode.MODEL_NOT_FOUND, 'Upstream model not found', options);
  if (status === 429) return new RouterError(ErrorCode.PROVIDER_RATE_LIMITED, undefined, options);
  if (status !== undefined && (status >= 500 || status === 408)) {
    return new RouterError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, options);
  }
  if (status === 401 || status === 403) return new RouterError(ErrorCode.INTERNAL_ERROR, undefined, options);

  // SSE `error` events become APIError instances without an HTTP status in both the
  // Anthropic and OpenAI SDKs. Anthropic classifies by `type`; OpenAI uses `type`
  // for server failures and `code` for rate limits, and HTTP 429 quota errors that
  // arrive statusless mid-stream carry `type: insufficient_quota`.
  const upstreamType = typeof candidate.type === 'string' ? candidate.type : undefined;
  const upstreamCode = typeof candidate.code === 'string' ? candidate.code : undefined;
  if (upstreamType === 'rate_limit_error' || upstreamType === 'insufficient_quota' || upstreamCode === 'rate_limit_exceeded') {
    return new RouterError(ErrorCode.PROVIDER_RATE_LIMITED, undefined, options);
  }
  if (upstreamType === 'overloaded_error' || upstreamType === 'api_error' || upstreamType === 'server_error') {
    return new RouterError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, options);
  }
  if (upstreamType === 'timeout_error') return new RouterError(ErrorCode.PROVIDER_TIMEOUT, undefined, options);
  if (upstreamType === 'invalid_request_error') {
    return new RouterError(ErrorCode.INVALID_REQUEST, 'Upstream provider rejected the request', options);
  }
  if (upstreamType === 'not_found_error') return new RouterError(ErrorCode.MODEL_NOT_FOUND, 'Upstream model not found', options);
  if (upstreamType === 'authentication_error' || upstreamType === 'permission_error' || upstreamType === 'billing_error') {
    return new RouterError(ErrorCode.INTERNAL_ERROR, undefined, options);
  }

  // Check the timeout name before the connection name: the SDKs' timeout error extends their connection error.
  if (TIMEOUT_NAMES.has(nameOf(candidate))) {
    return new RouterError(ErrorCode.PROVIDER_TIMEOUT, undefined, options);
  }
  if (CONNECTION_NAMES.has(nameOf(candidate)) || hasConnectionCode(candidate)) {
    return new RouterError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, options);
  }
  return new RouterError(ErrorCode.INTERNAL_ERROR, undefined, options);
}

/**
 * Node's fetch reports network failures as `TypeError: fetch failed` with the
 * ECONNREFUSED / ENOTFOUND code on `cause` (sometimes nested), so the chain is walked.
 */
function hasConnectionCode(error: ErrorLike): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, cause, errors } = current as ErrorLike & { errors?: unknown };
    if (typeof code === 'string' && CONNECTION_CODES.has(code.toUpperCase())) return true;
    if (Array.isArray(errors) && errors.some((inner) => hasConnectionCode(asErrorLike(inner)))) return true;
    current = cause;
  }
  return false;
}

function asErrorLike(value: unknown): ErrorLike {
  return typeof value === 'object' && value !== null ? (value as ErrorLike) : {};
}

function nameOf(error: ErrorLike): string {
  return typeof error.name === 'string' ? error.name : '';
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
