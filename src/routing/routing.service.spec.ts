import { Logger } from '@nestjs/common';
import { FakeOutcome, FakeProvider, okChunks, okResponse } from '../../test/fake-provider';
import { ClientDisconnected } from '../common/errors/client-disconnected';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import type { AppConfig } from '../config/app-config';
import { ModelRegistryService } from '../models/model-registry.service';
import { ProviderRegistry } from '../providers/provider-registry';
import type { UnifiedStreamChunk } from '../providers/unified.types';
import { FallbackService } from './fallback.service';
import { RoutingRequest, RoutingService } from './routing.service';

const config = {
  databaseUrl: 'x',
  providerTimeoutMs: 50,
  streamFirstChunkTimeoutMs: 50,
  streamIdleTimeoutMs: 50,
} as AppConfig;

const ANTHROPIC = 'anthropic/claude-sonnet';
const OPENAI = 'openai/gpt-5';

function build(providers: FakeProvider[]): RoutingService {
  return new RoutingService(new ModelRegistryService(config), new ProviderRegistry(providers), new FallbackService(), config);
}

function request(models: string[], clientSignal?: AbortSignal): RoutingRequest {
  return { requestId: 'lr_req_test', models, messages: [{ role: 'user', content: 'hi' }], clientSignal };
}

async function collect(chunks: AsyncIterable<UnifiedStreamChunk>): Promise<UnifiedStreamChunk[]> {
  const out: UnifiedStreamChunk[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('RoutingService.plan', () => {
  const service = build([]);

  it('resolves aliases to provider and upstream model', () => {
    expect(service.plan([ANTHROPIC, OPENAI])).toEqual([
      { publicModel: ANTHROPIC, provider: 'anthropic', upstreamModel: 'claude-sonnet-5' },
      { publicModel: OPENAI, provider: 'openai', upstreamModel: 'gpt-5' },
    ]);
  });

  it('rejects an empty list and more than two models', () => {
    expect(() => service.plan([])).toThrow(RouterError);
    const error = (() => {
      try {
        service.plan([ANTHROPIC, OPENAI, 'google/gemini-2.5-pro']);
      } catch (e) {
        return e as RouterError;
      }
      return undefined;
    })();
    expect(error?.code).toBe(ErrorCode.INVALID_REQUEST);
    expect(error?.message).toBe('Maximum of 2 models allowed');
  });

  it('fails fast on an unknown alias anywhere in the list', () => {
    expect(() => service.plan([ANTHROPIC, 'openai/gpt'])).toThrow(
      expect.objectContaining({ code: ErrorCode.MODEL_NOT_FOUND, model: 'openai/gpt' }),
    );
  });
});

describe('RoutingService.execute', () => {
  it('returns the served alias, provider, and attempt count; passes the upstream id to the adapter', async () => {
    const openai = new FakeProvider('openai', [{ response: okResponse('hi') }]);
    const result = await build([openai]).execute(request([OPENAI]));
    expect(result).toMatchObject({ publicModel: OPENAI, provider: 'openai', attempts: 1 });
    expect(result.response.content).toBe('hi');
    expect(openai.calls[0].model).toBe('gpt-5');
    expect(openai.calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('skips an unconfigured provider and falls back', async () => {
    const openai = new FakeProvider('openai', [{ response: okResponse() }]);
    const result = await build([openai]).execute(request([ANTHROPIC, OPENAI]));
    expect(result).toMatchObject({ publicModel: OPENAI, provider: 'openai', attempts: 2 });
  });

  it('returns provider_unavailable stamped with the model when a single provider is unconfigured', async () => {
    const error = (await rejection(build([]).execute(request([ANTHROPIC])))) as RouterError;
    expect(error).toBeInstanceOf(RouterError);
    expect(error).toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE, httpStatus: 502, provider: 'anthropic', model: ANTHROPIC });
  });

  it('falls back on a retryable provider error', async () => {
    const anthropic = new FakeProvider('anthropic', [{ error: new RouterError(ErrorCode.PROVIDER_RATE_LIMITED) }]);
    const openai = new FakeProvider('openai', [{ response: okResponse() }]);
    const result = await build([anthropic, openai]).execute(request([ANTHROPIC, OPENAI]));
    expect(result.attempts).toBe(2);
    expect(openai.calls).toHaveLength(1);
  });

  it('does not fall back on a non-retryable provider error, and stamps provider and model', async () => {
    const anthropic = new FakeProvider('anthropic', [{ error: new RouterError(ErrorCode.INVALID_REQUEST, 'bad') }]);
    const openai = new FakeProvider('openai', [{ response: okResponse() }]);
    const error = (await rejection(build([anthropic, openai]).execute(request([ANTHROPIC, OPENAI])))) as RouterError;
    expect(error).toMatchObject({ code: ErrorCode.INVALID_REQUEST, provider: 'anthropic', model: ANTHROPIC });
    expect(openai.calls).toHaveLength(0);
  });

  it('maps an attempt timeout to provider_timeout even when the adapter ignores the signal', async () => {
    const anthropic = new FakeProvider('anthropic', [{ hang: true }]);
    const openai = new FakeProvider('openai', [{ response: okResponse() }]);
    const result = await build([anthropic, openai]).execute(request([ANTHROPIC, OPENAI]));
    expect(result).toMatchObject({ provider: 'openai', attempts: 2 });
    expect(anthropic.calls[0].signal.aborted).toBe(true);
  });

  it('maps a timeout on the last attempt to a 504', async () => {
    const anthropic = new FakeProvider('anthropic', [{ hang: true, honorSignal: true }]);
    const error = (await rejection(build([anthropic]).execute(request([ANTHROPIC])))) as RouterError;
    expect(error).toMatchObject({ code: ErrorCode.PROVIDER_TIMEOUT, httpStatus: 504 });
  });

  it('throws ClientDisconnected and never falls back when the client goes away', async () => {
    const anthropic = new FakeProvider('anthropic', [{ hang: true, honorSignal: true }]);
    const openai = new FakeProvider('openai', [{ response: okResponse() }]);
    const client = new AbortController();
    const pending = build([anthropic, openai]).execute(request([ANTHROPIC, OPENAI], client.signal));
    setTimeout(() => client.abort(), 5);
    await expect(pending).rejects.toBeInstanceOf(ClientDisconnected);
    expect(openai.calls).toHaveLength(0);
  });

  it('wraps unknown adapter errors as internal_error without fallback', async () => {
    const anthropic = new FakeProvider('anthropic', [{ error: new TypeError('undefined is not a function') }]);
    const openai = new FakeProvider('openai', [{ response: okResponse() }]);
    const error = (await rejection(build([anthropic, openai]).execute(request([ANTHROPIC, OPENAI])))) as RouterError;
    expect(error).toMatchObject({ code: ErrorCode.INTERNAL_ERROR, provider: 'anthropic' });
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(openai.calls).toHaveLength(0);
  });
});

describe('RoutingService.executeStream', () => {
  it('yields the first chunk and the rest, and closes the adapter stream', async () => {
    const openai = new FakeProvider('openai', [{ chunks: okChunks('hi') }]);
    const result = await build([openai]).executeStream(request([OPENAI]));
    expect(result).toMatchObject({ publicModel: OPENAI, provider: 'openai', attempts: 1 });
    await expect(collect(result.chunks)).resolves.toEqual(okChunks('hi'));
    expect(openai.streamsClosed).toBe(1);
  });

  it('falls back when the first attempt fails before its first chunk', async () => {
    const anthropic = new FakeProvider('anthropic', [{ error: new RouterError(ErrorCode.PROVIDER_UNAVAILABLE) }]);
    const openai = new FakeProvider('openai', [{ chunks: okChunks() }]);
    const result = await build([anthropic, openai]).executeStream(request([ANTHROPIC, OPENAI]));
    expect(result.attempts).toBe(2);
    await expect(collect(result.chunks)).resolves.toEqual(okChunks());
  });

  it('falls back when the first chunk does not arrive in time', async () => {
    const anthropic = new FakeProvider('anthropic', [{ hang: true }]);
    const openai = new FakeProvider('openai', [{ chunks: okChunks() }]);
    const result = await build([anthropic, openai]).executeStream(request([ANTHROPIC, OPENAI]));
    expect(result.provider).toBe('openai');
  });

  it('treats an empty stream as provider_unavailable', async () => {
    const anthropic = new FakeProvider('anthropic', [{ chunks: [] }]);
    const openai = new FakeProvider('openai', [{ chunks: okChunks() }]);
    const result = await build([anthropic, openai]).executeStream(request([ANTHROPIC, OPENAI]));
    expect(result.attempts).toBe(2);
  });

  it('does not fall back once committed: an error after the first chunk surfaces from the iterable', async () => {
    const outcomes: FakeOutcome[] = [{ chunks: [{ type: 'delta', text: 'partial' }, new RouterError(ErrorCode.PROVIDER_UNAVAILABLE)] }];
    const anthropic = new FakeProvider('anthropic', outcomes);
    const openai = new FakeProvider('openai', [{ chunks: okChunks() }]);
    const result = await build([anthropic, openai]).executeStream(request([ANTHROPIC, OPENAI]));
    expect(result.attempts).toBe(1);
    const iterator = result.chunks[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { type: 'delta', text: 'partial' } });
    const error = (await rejection(iterator.next())) as RouterError;
    expect(error).toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE, provider: 'anthropic', model: ANTHROPIC });
    expect(openai.calls).toHaveLength(0);
  });

  it('maps silence between chunks to provider_timeout after commit', async () => {
    const anthropic = new FakeProvider('anthropic', [{ chunks: [{ type: 'delta', text: 'a' }, { type: 'delta', text: '<hang>' }] }]);
    const result = await build([anthropic]).executeStream(request([ANTHROPIC]));
    const error = (await rejection(collect(result.chunks))) as RouterError;
    expect(error).toMatchObject({ code: ErrorCode.PROVIDER_TIMEOUT });
    expect(anthropic.streamsClosed).toBe(1);
  });

  it('stops the adapter stream when the consumer stops early', async () => {
    const anthropic = new FakeProvider('anthropic', [{ chunks: okChunks() }]);
    const result = await build([anthropic]).executeStream(request([ANTHROPIC]));
    for await (const chunk of result.chunks) {
      expect(chunk.type).toBe('delta');
      break;
    }
    expect(anthropic.streamsClosed).toBe(1);
  });

  it('surfaces ClientDisconnected mid-stream', async () => {
    const client = new AbortController();
    const anthropic = new FakeProvider('anthropic', [{ chunks: [{ type: 'delta', text: 'a' }, { type: 'delta', text: '<hang>' }] }]);
    const result = await build([anthropic]).executeStream(request([ANTHROPIC], client.signal));
    setTimeout(() => client.abort(), 5);
    await expect(collect(result.chunks)).rejects.toBeInstanceOf(ClientDisconnected);
  });
});
