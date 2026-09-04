import { Logger } from '@nestjs/common';
import { ClientDisconnected } from '../common/errors/client-disconnected';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import type { RoutingResult, RoutingService } from '../routing/routing.service';
import type { UsageService } from '../usage/usage.service';
import { ChatService } from './chat.service';
import type { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

const context = { requestId: 'lr_req_1', apiKeyId: 'key-1' };
const dto = { model: 'openai/gpt-5', messages: [{ role: 'user', content: 'hi' }], stream: false } as ChatCompletionRequestDto;

function build(execute: jest.Mock): { service: ChatService; record: jest.Mock } {
  const record = jest.fn().mockResolvedValue(undefined);
  const service = new ChatService({ execute } as unknown as RoutingService, { record } as unknown as UsageService);
  return { service, record };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('ChatService.complete', () => {
  it('records a success row with tokens and the served model', async () => {
    const result: RoutingResult = {
      publicModel: 'openai/gpt-5',
      provider: 'openai',
      attempts: 2,
      response: { content: 'hello', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } },
    };
    const { service, record } = build(jest.fn().mockResolvedValue(result));
    const completion = await service.complete(dto, context);
    expect(completion.choices[0].message.content).toBe('hello');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'lr_req_1',
        apiKeyId: 'key-1',
        model: 'openai/gpt-5',
        provider: 'openai',
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
        status: 'success',
      }),
    );
  });

  it('records an error row naming the last attempted model and rethrows', async () => {
    const failure = new RouterError(ErrorCode.PROVIDER_TIMEOUT, undefined, { provider: 'openai', model: 'openai/gpt-5' });
    const { service, record } = build(jest.fn().mockRejectedValue(failure));
    await expect(service.complete(dto, context)).rejects.toBe(failure);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-5', provider: 'openai', promptTokens: null, status: 'error:provider_timeout' }),
    );
  });

  it('records client_disconnect', async () => {
    const { service, record } = build(jest.fn().mockRejectedValue(new ClientDisconnected()));
    await expect(service.complete(dto, context)).rejects.toBeInstanceOf(ClientDisconnected);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ status: 'client_disconnect', provider: null }));
  });

  it('records error:internal_error for unexpected failures', async () => {
    const { service, record } = build(jest.fn().mockRejectedValue(new Error('boom')));
    await expect(service.complete(dto, context)).rejects.toThrow('boom');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ status: 'error:internal_error' }));
  });

  it('rejects bodies with neither or both of model and models before touching routing or usage', async () => {
    const execute = jest.fn();
    const { service, record } = build(execute);
    const neither = { ...dto, model: undefined } as ChatCompletionRequestDto;
    const both = { ...dto, models: ['openai/gpt-5'] } as ChatCompletionRequestDto;
    await expect(service.complete(neither, context)).rejects.toMatchObject({ code: ErrorCode.INVALID_REQUEST });
    await expect(service.complete(both, context)).rejects.toMatchObject({ code: ErrorCode.INVALID_REQUEST });
    expect(execute).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('passes the models list through in order', async () => {
    const execute = jest.fn().mockResolvedValue({
      publicModel: 'openai/gpt-5',
      provider: 'openai',
      attempts: 2,
      response: { content: '', finishReason: 'stop', usage: null },
    });
    const { service } = build(execute);
    await service.complete({ ...dto, model: undefined, models: ['anthropic/claude-sonnet', 'openai/gpt-5'] } as ChatCompletionRequestDto, context);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ models: ['anthropic/claude-sonnet', 'openai/gpt-5'] }));
  });
});
