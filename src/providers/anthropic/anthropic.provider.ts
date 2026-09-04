import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../llm-provider.interface';
import { mapProviderError } from '../provider-error';
import type { UnifiedChatRequest, UnifiedChatResponse, UnifiedStreamChunk } from '../unified.types';
import { fromAnthropicResponse, toAnthropicRequest } from './anthropic.mapper';

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

  async *stream(_request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    throw new Error('Anthropic streaming is implemented in Phase 6');
  }
}
