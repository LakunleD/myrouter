import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCode } from '../errors/error-code';
import { RouterError } from '../errors/router-error';
import type { RouterRequest } from '../router-request';

export interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
}

export interface ErrorBody {
  error: { message: string; type: ErrorCode; code: ErrorCode; request_id: string };
}

export function normalizeError(exception: unknown): NormalizedError {
  if (exception instanceof RouterError) {
    return { status: exception.httpStatus, code: exception.code, message: exception.message };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    let message = exception.message;
    if (typeof body === 'string') {
      message = body;
    } else if (typeof body === 'object' && body !== null && 'message' in body) {
      const inner = (body as { message: unknown }).message;
      message = Array.isArray(inner) ? inner.join('; ') : String(inner);
    }
    const code =
      status === 401 ? ErrorCode.INVALID_API_KEY : status < 500 ? ErrorCode.INVALID_REQUEST : ErrorCode.INTERNAL_ERROR;
    return { status, code, message };
  }
  return { status: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' };
}

export function errorBody(normalized: NormalizedError, requestId: string): ErrorBody {
  return {
    error: { message: normalized.message, type: normalized.code, code: normalized.code, request_id: requestId },
  };
}

/**
 * Log-safe view of a thrown value. For a RouterError it includes the provider,
 * upstream status, and the wrapped cause's name and message, which is where a
 * bad upstream credential or an unexpected SDK failure actually shows up.
 */
export function describeError(exception: unknown, depth = 0): unknown {
  if (exception instanceof RouterError) {
    return {
      name: exception.name,
      code: exception.code,
      message: exception.message,
      provider: exception.provider,
      model: exception.model,
      upstream_status: exception.upstreamStatus,
      cause: exception.cause === undefined ? undefined : describeError(exception.cause, depth + 1),
    };
  }
  if (exception instanceof Error) {
    const withCode = exception as Error & { code?: unknown; status?: unknown };
    return {
      name: exception.name,
      message: exception.message,
      code: typeof withCode.code === 'string' ? withCode.code : undefined,
      status: typeof withCode.status === 'number' ? withCode.status : undefined,
      stack: depth === 0 ? exception.stack : undefined,
      cause: exception.cause === undefined || depth >= 3 ? undefined : describeError(exception.cause, depth + 1),
    };
  }
  return exception;
}

/** Renders every throwable in the one error shape. It never records usage; ChatService owns that. */
@Catch()
export class RouterExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RouterExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RouterRequest>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId ?? 'unknown';
    const normalized = normalizeError(exception);

    if (normalized.code === ErrorCode.INTERNAL_ERROR) {
      this.logger.error({ request_id: requestId, msg: 'Unhandled error', err: describeError(exception) });
    }

    if (res.headersSent) {
      // A streaming response already committed; ChatService has written its own error frame.
      res.end();
      return;
    }
    res.status(normalized.status).json(errorBody(normalized, requestId));
  }
}
