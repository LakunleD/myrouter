import { ERROR_SPECS, ErrorCode } from './error-code';

export interface RouterErrorOptions {
  provider?: string;
  model?: string;
  upstreamStatus?: number;
  cause?: unknown;
}

/**
 * The single error type that crosses module boundaries. Everything the client
 * sees is derived from `code`; `retryable` drives the fallback loop.
 * `provider` and `model` are stamped by routing so the usage row can name the
 * last attempt.
 */
export class RouterError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly upstreamStatus?: number;
  override readonly cause?: unknown;
  provider?: string;
  model?: string;

  constructor(code: ErrorCode, message?: string, options: RouterErrorOptions = {}) {
    const spec = ERROR_SPECS[code];
    super(message ?? spec.defaultMessage);
    this.name = 'RouterError';
    this.code = code;
    this.httpStatus = spec.httpStatus;
    this.retryable = spec.retryable;
    this.provider = options.provider;
    this.model = options.model;
    this.upstreamStatus = options.upstreamStatus;
    this.cause = options.cause;
  }
}
