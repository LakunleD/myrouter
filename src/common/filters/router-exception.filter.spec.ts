import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ErrorCode } from '../errors/error-code';
import { RouterError } from '../errors/router-error';
import { describeError, errorBody, normalizeError } from './router-exception.filter';

describe('normalizeError', () => {
  it('uses the RouterError code and status', () => {
    const normalized = normalizeError(new RouterError(ErrorCode.PROVIDER_RATE_LIMITED));
    expect(normalized).toEqual({
      status: 429,
      code: ErrorCode.PROVIDER_RATE_LIMITED,
      message: 'Upstream provider rate limited the request',
    });
  });

  it('joins validation messages from a Nest BadRequestException', () => {
    const normalized = normalizeError(new BadRequestException(['messages must be an array', 'model must be a string']));
    expect(normalized.status).toBe(400);
    expect(normalized.code).toBe(ErrorCode.INVALID_REQUEST);
    expect(normalized.message).toBe('messages must be an array; model must be a string');
  });

  it('maps 401 HttpExceptions to invalid_api_key', () => {
    expect(normalizeError(new UnauthorizedException()).code).toBe(ErrorCode.INVALID_API_KEY);
  });

  it('hides details of unexpected errors', () => {
    const normalized = normalizeError(new Error('secret stack'));
    expect(normalized).toEqual({ status: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' });
  });
});

describe('errorBody', () => {
  it('produces the wire shape with the request id', () => {
    const body = errorBody({ status: 404, code: ErrorCode.MODEL_NOT_FOUND, message: 'nope' }, 'lr_req_1');
    expect(body).toEqual({
      error: { message: 'nope', type: 'model_not_found', code: 'model_not_found', request_id: 'lr_req_1' },
    });
  });
});

describe('describeError', () => {
  it('surfaces provider, upstream status, and the wrapped cause of a RouterError', () => {
    const upstream = Object.assign(new Error('invalid x-api-key'), { status: 401, name: 'AuthenticationError' });
    const error = new RouterError(ErrorCode.INTERNAL_ERROR, undefined, {
      provider: 'anthropic',
      model: 'anthropic/claude-sonnet',
      upstreamStatus: 401,
      cause: upstream,
    });
    expect(describeError(error)).toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      provider: 'anthropic',
      model: 'anthropic/claude-sonnet',
      upstream_status: 401,
      cause: { name: 'AuthenticationError', message: 'invalid x-api-key', status: 401 },
    });
  });

  it('walks nested causes with a bound and keeps the stack only at the top', () => {
    const inner = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    const outer = new TypeError('fetch failed', { cause: inner });
    const described = describeError(outer) as { stack?: string; cause: { code?: string; stack?: string } };
    expect(described.stack).toBeDefined();
    expect(described.cause).toMatchObject({ message: 'connect', code: 'ECONNREFUSED' });
    expect(described.cause.stack).toBeUndefined();
  });
});
