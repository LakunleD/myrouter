import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { RouterRequest } from '../common/router-request';
import { ChatController } from './chat.controller';
import type { ChatService } from './chat.service';
import type { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

describe('ChatController disconnect handling', () => {
  it('aborts the client signal when the response closes prematurely', async () => {
    const request = Object.assign(new EventEmitter(), { requestId: 'lr_req_1', apiKey: { id: 'key-1', name: 'test' } });
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    let observed: AbortSignal | undefined;
    const stream = jest.fn(async (_dto, context: { clientSignal: AbortSignal }) => {
      observed = context.clientSignal;
      await new Promise<void>((resolve) => context.clientSignal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const controller = new ChatController({ stream } as unknown as ChatService);
    const pending = controller.complete(
      { model: 'openai/gpt-5', messages: [], stream: true } as ChatCompletionRequestDto,
      request as unknown as RouterRequest,
      response as unknown as Response,
    );
    await Promise.resolve();
    response.emit('close');
    await pending;
    expect(observed?.aborted).toBe(true);
    expect(response.listenerCount('close')).toBe(0);
  });
});
