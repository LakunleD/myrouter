import type Anthropic from '@anthropic-ai/sdk';
import type { GoogleGenAI } from '@google/genai';
import type OpenAI from 'openai';
import { AnthropicProvider } from './anthropic/anthropic.provider';
import { GoogleProvider } from './google/google.provider';
import { OpenAIProvider } from './openai/openai.provider';
import type { UnifiedChatRequest, UnifiedStreamChunk } from './unified.types';

const request: UnifiedChatRequest = {
  requestId: 'lr_req_test', model: 'upstream', messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 10, signal: new AbortController().signal,
};

async function* iterable<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}

async function collect(source: AsyncIterable<UnifiedStreamChunk>): Promise<UnifiedStreamChunk[]> {
  const result: UnifiedStreamChunk[] = [];
  for await (const item of source) result.push(item);
  return result;
}

describe('truncated upstream streams', () => {
  const truncated = expect.objectContaining({ code: 'provider_unavailable', retryable: true, message: 'Upstream stream ended before completion' });

  it('OpenAI: a stream that ends without finish_reason is an error, not a completion', async () => {
    const create = jest.fn().mockResolvedValue(iterable([{ choices: [{ delta: { content: 'partial' }, finish_reason: null }] }]));
    const provider = new OpenAIProvider({ chat: { completions: { create } } } as unknown as OpenAI);
    const received: UnifiedStreamChunk[] = [];
    await expect(
      (async () => {
        for await (const chunk of provider.stream(request)) received.push(chunk);
      })(),
    ).rejects.toEqual(truncated);
    expect(received).toEqual([{ type: 'delta', text: 'partial' }]);
  });

  it('Anthropic: a stream that ends without message_delta is an error', async () => {
    const create = jest.fn().mockResolvedValue(iterable([
      { type: 'message_start', message: { usage: { input_tokens: 4 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
    ]));
    const provider = new AnthropicProvider({ messages: { create } } as unknown as Anthropic);
    await expect(collect(provider.stream(request))).rejects.toEqual(truncated);
  });

  it('Google: a stream that ends without finishReason is an error', async () => {
    const generateContentStream = jest.fn().mockResolvedValue(iterable([{ text: 'partial', candidates: [{}] }]));
    const provider = new GoogleProvider({ models: { generateContentStream } } as unknown as GoogleGenAI);
    await expect(collect(provider.stream(request))).rejects.toEqual(truncated);
  });

  it('an empty upstream stream is also an error', async () => {
    const create = jest.fn().mockResolvedValue(iterable([]));
    const provider = new OpenAIProvider({ chat: { completions: { create } } } as unknown as OpenAI);
    await expect(collect(provider.stream(request))).rejects.toEqual(truncated);
  });
});

describe('provider streaming adapters', () => {
  it('maps OpenAI deltas, finish reason, and final usage', async () => {
    const create = jest.fn().mockResolvedValue(iterable([
      { choices: [{ delta: { role: 'assistant' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'hello' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
    ]));
    const provider = new OpenAIProvider({ chat: { completions: { create } } } as unknown as OpenAI);
    await expect(collect(provider.stream(request))).resolves.toEqual([
      { type: 'delta', text: 'hello' },
      { type: 'finish', finishReason: 'length', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } },
    ]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true, stream_options: { include_usage: true } }), { signal: request.signal });
  });

  it('maps Anthropic text events and usage', async () => {
    const create = jest.fn().mockResolvedValue(iterable([
      { type: 'message_start', message: { usage: { input_tokens: 4 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]));
    const provider = new AnthropicProvider({ messages: { create } } as unknown as Anthropic);
    await expect(collect(provider.stream(request))).resolves.toEqual([
      { type: 'delta', text: 'hello' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 } },
    ]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), { signal: request.signal });
  });

  it('maps Google chunks, safety finish, and usage', async () => {
    const generateContentStream = jest.fn().mockResolvedValue(iterable([
      { text: 'hello', candidates: [{}] },
      { candidates: [{ finishReason: 'SAFETY' }] },
      {
        text: '', candidates: [],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 },
      },
    ]));
    const provider = new GoogleProvider({ models: { generateContentStream } } as unknown as GoogleGenAI);
    await expect(collect(provider.stream(request))).resolves.toEqual([
      { type: 'delta', text: 'hello' },
      { type: 'finish', finishReason: 'content_filter', usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 } },
    ]);
    expect(generateContentStream).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: request.signal }) }));
  });

  it('maps a statusless Anthropic overload as retryable', async () => {
    const failure = Object.assign(new Error('overloaded'), { name: 'APIError', type: 'overloaded_error' });
    const create = jest.fn().mockResolvedValue((async function* () { throw failure; })());
    const provider = new AnthropicProvider({ messages: { create } } as unknown as Anthropic);
    await expect(collect(provider.stream(request))).rejects.toMatchObject({
      code: 'provider_unavailable', retryable: true,
    });
  });
});
