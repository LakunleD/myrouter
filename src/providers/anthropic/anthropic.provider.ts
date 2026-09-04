import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../llm-provider.interface';
import { mapProviderError } from '../provider-error';
import type { FinishReason, UnifiedChatRequest, UnifiedChatResponse, UnifiedStreamChunk } from '../unified.types';
import { fromAnthropicResponse, mapAnthropicFinishReason, toAnthropicRequest, toAnthropicStreamRequest } from './anthropic.mapper';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;

  constructor(private readonly client: Anthropic) {}

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const response = await this.client.messages.create(toAnthropicRequest(request), { signal: request.signal });
      return fromAnthropicResponse(response);
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  async *stream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    try {
      const stream = await this.client.messages.create(toAnthropicStreamRequest(request), { signal: request.signal });
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason: FinishReason = 'stop';
      for await (const event of stream) {
        if (event.type === 'message_start') inputTokens = event.message.usage.input_tokens;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
          yield { type: 'delta', text: event.delta.text };
        }
        if (event.type === 'message_delta') {
          outputTokens = event.usage.output_tokens;
          finishReason = mapAnthropicFinishReason(event.delta.stop_reason);
        }
      }
      yield {
        type: 'finish',
        finishReason,
        usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens },
      };
    } catch (error) {
      throw mapProviderError(error);
    }
  }
}
