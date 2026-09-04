import { ErrorCode } from '../common/errors/error-code';
import { mapProviderError } from './provider-error';

describe('mapProviderError', () => {
  it.each([
    [400, ErrorCode.INVALID_REQUEST, false],
    [422, ErrorCode.INVALID_REQUEST, false],
    [404, ErrorCode.MODEL_NOT_FOUND, false],
    [408, ErrorCode.PROVIDER_UNAVAILABLE, true],
    [429, ErrorCode.PROVIDER_RATE_LIMITED, true],
    [500, ErrorCode.PROVIDER_UNAVAILABLE, true],
    [503, ErrorCode.PROVIDER_UNAVAILABLE, true],
    [529, ErrorCode.PROVIDER_UNAVAILABLE, true],
    [401, ErrorCode.INTERNAL_ERROR, false],
    [403, ErrorCode.INTERNAL_ERROR, false],
  ])('maps status %s', (status, code, retryable) => {
    expect(mapProviderError({ status })).toMatchObject({ code, retryable, upstreamStatus: status });
  });

  it('maps connection errors carried on the error itself', () => {
    expect(mapProviderError({ code: 'ECONNRESET' })).toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE, retryable: true });
  });

  it('maps Node fetch failures whose code sits on error.cause', () => {
    const fetchFailed = new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });
    expect(mapProviderError(fetchFailed)).toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE, retryable: true });
  });

  it('maps AggregateError causes such as dual-stack ECONNREFUSED', () => {
    const aggregate = new AggregateError([Object.assign(new Error('v4'), { code: 'ECONNREFUSED' })], 'both failed');
    const fetchFailed = new TypeError('fetch failed', { cause: aggregate });
    expect(mapProviderError(fetchFailed)).toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE });
  });

  it('maps SDK connection errors by class name', () => {
    expect(mapProviderError({ name: 'APIConnectionError' })).toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE });
  });

  it('maps SDK request timeouts to provider_timeout', () => {
    expect(mapProviderError({ name: 'APIConnectionTimeoutError' })).toMatchObject({
      code: ErrorCode.PROVIDER_TIMEOUT,
      retryable: true,
    });
  });

  it('passes RouterErrors through untouched', () => {
    const original = mapProviderError({ status: 429 });
    expect(mapProviderError(original)).toBe(original);
  });

  it('does not expose unknown errors but keeps them as cause', () => {
    const unknown = new Error('provider secret');
    const error = mapProviderError(unknown);
    expect(error).toMatchObject({ code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' });
    expect(error.cause).toBe(unknown);
  });
});
