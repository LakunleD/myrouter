import type OpenAI from 'openai';
import type { LLMProvider } from '../llm-provider.interface';
import { mapProviderError } from '../provider-error';
import type { UnifiedChatRequest, UnifiedChatResponse, UnifiedStreamChunk } from '../unified.types';
import { fromOpenAIResponse, toOpenAIRequest } from './openai.mapper';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;

  constructor(private readonly client: OpenAI) {}

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const response = await this.client.chat.completions.create(toOpenAIRequest(request), { signal: request.signal });
      return fromOpenAIResponse(response);
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  async *stream(_request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    throw new Error('OpenAI streaming is implemented in Phase 6');
  }
}
