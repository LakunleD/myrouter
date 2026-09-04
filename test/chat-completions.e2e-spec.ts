import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiKeyService } from '../src/auth/api-key.service';
import { ErrorCode } from '../src/common/errors/error-code';
import { RouterError } from '../src/common/errors/router-error';
import { configureApp } from '../src/main';
import { ProviderRegistry } from '../src/providers/provider-registry';
import { UsageService } from '../src/usage/usage.service';
import { FakeProvider, okResponse } from './fake-provider';

const AUTH = { Authorization: 'Bearer lr_valid' };
const USER = [{ role: 'user', content: 'hi' }];

describe('POST /v1/chat/completions', () => {
  let app: INestApplication;
  const openai = new FakeProvider('openai', [{ response: okResponse('hello') }]);
  const anthropic = new FakeProvider('anthropic', [{ response: okResponse('bonjour') }]);
  const record = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ApiKeyService)
      .useValue({ findActive: jest.fn(async (key: string) => (key === 'lr_valid' ? { id: 'key-id', name: 'test' } : null)) })
      .overrideProvider(ProviderRegistry)
      .useValue(new ProviderRegistry([openai, anthropic]))
      .overrideProvider(UsageService)
      .useValue({ record })
      .compile();
    const expressApp = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(expressApp);
    app = expressApp;
    await app.init();
  });

  beforeEach(() => {
    openai.script([{ response: okResponse('hello') }]);
    anthropic.script([{ response: okResponse('bonjour') }]);
    record.mockClear();
  });

  afterAll(async () => app.close());

  const post = (body: object, headers: Record<string, string> = AUTH) =>
    request(app.getHttpServer()).post('/v1/chat/completions').set(headers).send(body);

  describe('authentication and validation', () => {
    it('requires an API key, returns a request id on errors, and records no usage', async () => {
      const response = await post({ model: 'openai/gpt-5', messages: USER }, {}).expect(401);
      expect(response.headers['x-request-id']).toMatch(/^lr_req_/);
      expect(response.body.error).toMatchObject({ code: 'invalid_api_key', request_id: response.headers['x-request-id'] });
      expect(record).not.toHaveBeenCalled();
    });

    it('validates the request body', async () => {
      const response = await post({ model: 'openai/gpt-5', messages: [], tools: [] }).expect(400);
      expect(response.body.error.code).toBe('invalid_request');
      expect(record).not.toHaveBeenCalled();
    });

    it('requires exactly one of model and models', async () => {
      await post({ messages: USER }).expect(400);
      const both = await post({ model: 'openai/gpt-5', models: ['openai/gpt-5'], messages: USER }).expect(400);
      expect(both.body.error.message).toContain('exactly one');
      expect(record).not.toHaveBeenCalled();
    });

    it('rejects more than two models explicitly', async () => {
      const response = await post({
        models: ['anthropic/claude-sonnet', 'openai/gpt-5', 'google/gemini-2.5-pro'],
        messages: USER,
      }).expect(400);
      expect(response.body.error.message).toBe('Maximum of 2 models allowed');
    });

    it('rejects streaming until phase 6', async () => {
      const response = await post({ model: 'openai/gpt-5', messages: USER, stream: true }).expect(400);
      expect(response.body.error.code).toBe('invalid_request');
    });
  });

  describe('single model', () => {
    it('returns an OpenAI-compatible completion and records usage', async () => {
      const response = await post({ model: 'openai/gpt-5', messages: USER, temperature: 0.2 }).expect(200);
      expect(response.headers['x-request-id']).toMatch(/^lr_req_/);
      expect(response.body).toMatchObject({
        id: response.headers['x-request-id'],
        object: 'chat.completion',
        model: 'openai/gpt-5',
        choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
      expect(openai.calls.at(-1)).toMatchObject({ model: 'gpt-5', temperature: 0.2 });
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: response.headers['x-request-id'],
          apiKeyId: 'key-id',
          model: 'openai/gpt-5',
          provider: 'openai',
          promptTokens: 3,
          completionTokens: 2,
          totalTokens: 5,
          status: 'success',
        }),
      );
    });

    it('routes to Anthropic by changing the model', async () => {
      const response = await post({ model: 'anthropic/claude-sonnet', messages: USER }).expect(200);
      expect(response.body.choices[0].message.content).toBe('bonjour');
      expect(anthropic.calls.at(-1)).toMatchObject({ model: 'claude-sonnet-5' });
    });

    it('accepts a string-valued stop and forwards it as an array', async () => {
      await post({ model: 'openai/gpt-5', messages: USER, stop: 'END' }).expect(200);
      expect(openai.calls.at(-1)).toMatchObject({ stop: ['END'] });
    });

    it('returns 404 for an unknown model and records the failure', async () => {
      const response = await post({ model: 'missing/model', messages: USER }).expect(404);
      expect(response.body.error.code).toBe('model_not_found');
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'missing/model', provider: null, status: 'error:model_not_found' }),
      );
    });

    it('returns 502 when the only provider is not configured', async () => {
      const response = await post({ model: 'google/gemini-2.5-pro', messages: USER }).expect(502);
      expect(response.body.error.code).toBe('provider_unavailable');
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', status: 'error:provider_unavailable' }));
    });

    it('maps a provider failure to the normalized error and records it', async () => {
      openai.script([{ error: new RouterError(ErrorCode.PROVIDER_RATE_LIMITED, undefined, { upstreamStatus: 429 }) }]);
      const response = await post({ model: 'openai/gpt-5', messages: USER }).expect(429);
      expect(response.body.error).toMatchObject({ code: 'provider_rate_limited', request_id: response.headers['x-request-id'] });
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', status: 'error:provider_rate_limited' }));
    });
  });

  describe('fallback', () => {
    it('falls back on a retryable failure and reports the model that served', async () => {
      anthropic.script([{ error: new RouterError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, { upstreamStatus: 503 }) }]);
      const response = await post({ models: ['anthropic/claude-sonnet', 'openai/gpt-5'], messages: USER }).expect(200);
      expect(response.body.model).toBe('openai/gpt-5');
      expect(response.body.choices[0].message.content).toBe('hello');
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5', provider: 'openai', status: 'success' }));
    });

    it('does not fall back on a non-retryable failure', async () => {
      anthropic.script([{ error: new RouterError(ErrorCode.INVALID_REQUEST, 'Upstream provider rejected the request') }]);
      const response = await post({ models: ['anthropic/claude-sonnet', 'openai/gpt-5'], messages: USER }).expect(400);
      expect(response.body.error.code).toBe('invalid_request');
      expect(openai.calls).toHaveLength(0);
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ model: 'anthropic/claude-sonnet', status: 'error:invalid_request' }));
    });

    it('skips an unconfigured provider', async () => {
      const response = await post({ models: ['google/gemini-2.5-pro', 'openai/gpt-5'], messages: USER }).expect(200);
      expect(response.body.model).toBe('openai/gpt-5');
    });

    it('surfaces the last error when both attempts fail', async () => {
      anthropic.script([{ error: new RouterError(ErrorCode.PROVIDER_UNAVAILABLE) }]);
      openai.script([{ error: new RouterError(ErrorCode.PROVIDER_TIMEOUT) }]);
      const response = await post({ models: ['anthropic/claude-sonnet', 'openai/gpt-5'], messages: USER }).expect(504);
      expect(response.body.error.code).toBe('provider_timeout');
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5', status: 'error:provider_timeout' }));
    });
  });
});
