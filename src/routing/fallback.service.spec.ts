import { Logger } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import { Attempt, FallbackService } from './fallback.service';

const plan: Attempt[] = [
  { publicModel: 'anthropic/claude-sonnet', provider: 'anthropic', upstreamModel: 'claude-sonnet-5' },
  { publicModel: 'openai/gpt-5', provider: 'openai', upstreamModel: 'gpt-5' },
];

describe('FallbackService', () => {
  let service: FallbackService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    service = new FallbackService();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('returns the first success with attempts = 1', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(service.run('r1', plan, fn)).resolves.toEqual({ value: 'ok', attempt: plan[0], attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falls back on a retryable error and logs both models', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new RouterError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, { upstreamStatus: 503 }))
      .mockResolvedValueOnce('second');
    await expect(service.run('r1', plan, fn)).resolves.toEqual({ value: 'second', attempt: plan[1], attempts: 2 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'r1',
        from_model: 'anthropic/claude-sonnet',
        to_model: 'openai/gpt-5',
        code: ErrorCode.PROVIDER_UNAVAILABLE,
        upstream_status: 503,
      }),
    );
  });

  it('does not fall back on a non-retryable error', async () => {
    const fn = jest.fn().mockRejectedValue(new RouterError(ErrorCode.INVALID_REQUEST));
    await expect(service.run('r1', plan, fn)).rejects.toMatchObject({ code: ErrorCode.INVALID_REQUEST });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not fall back on errors that are not RouterErrors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(service.run('r1', plan, fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('surfaces the last error when every attempt fails', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new RouterError(ErrorCode.PROVIDER_RATE_LIMITED))
      .mockRejectedValueOnce(new RouterError(ErrorCode.PROVIDER_TIMEOUT));
    await expect(service.run('r1', plan, fn)).rejects.toMatchObject({ code: ErrorCode.PROVIDER_TIMEOUT });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not fall back from the last entry of a single-model plan', async () => {
    const fn = jest.fn().mockRejectedValue(new RouterError(ErrorCode.PROVIDER_UNAVAILABLE));
    await expect(service.run('r1', [plan[0]], fn)).rejects.toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty plan', async () => {
    await expect(service.run('r1', [], jest.fn())).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
  });
});
