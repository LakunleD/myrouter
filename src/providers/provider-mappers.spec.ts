import type { Message } from '@anthropic-ai/sdk/resources/messages';
import type { GenerateContentResponse } from '@google/genai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { fromAnthropicResponse, toAnthropicRequest } from './anthropic/anthropic.mapper';
import { fromGoogleResponse, toGoogleRequest } from './google/google.mapper';
import { fromOpenAIResponse, toOpenAIRequest } from './openai/openai.mapper';
import type { UnifiedChatRequest } from './unified.types';

const request: UnifiedChatRequest = {
  requestId: 'lr_req_test',
  model: 'upstream-model',
  messages: [
    { role: 'system', content: 'Be concise' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
  ],
  maxTokens: 100,
  temperature: 0.5,
  topP: 0.9,
  stop: ['END'],
  signal: new AbortController().signal,
};

describe('provider mappers', () => {
  it('maps OpenAI requests and responses', () => {
    const openaiRequest = toOpenAIRequest(request);
    expect(openaiRequest).toMatchObject({ model: 'upstream-model', max_completion_tokens: 100, stream: false });
    expect(openaiRequest).not.toHaveProperty('max_tokens');
    const response = {
      choices: [{ message: { content: 'answer' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    } as ChatCompletion;
    expect(fromOpenAIResponse(response)).toEqual({
      content: 'answer', finishReason: 'length', usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    });
  });

  it('moves Anthropic system messages out of the conversation and maps text/usage', () => {
    expect(toAnthropicRequest(request)).toMatchObject({
      system: 'Be concise', max_tokens: 100, messages: [{ role: 'user' }, { role: 'assistant' }],
    });
    const response = {
      content: [{ type: 'text', text: 'answer', citations: null }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 3 },
    } as unknown as Message;
    expect(fromAnthropicResponse(response)).toEqual({
      content: 'answer', finishReason: 'stop', usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    });
  });

  it('maps Google roles, system instruction, safety, and usage', () => {
    expect(toGoogleRequest(request)).toMatchObject({
      model: 'upstream-model',
      contents: [{ role: 'user' }, { role: 'model' }],
      config: { systemInstruction: 'Be concise', maxOutputTokens: 100 },
    });
    const response = {
      text: 'blocked',
      candidates: [{ finishReason: 'SAFETY' }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
    } as unknown as GenerateContentResponse;
    expect(fromGoogleResponse(response)).toEqual({
      content: 'blocked', finishReason: 'content_filter', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
    });
  });
});
