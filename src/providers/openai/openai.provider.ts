import type OpenAI from 'openai';
import type { LLMProvider } from '../llm-provider.interface';
import { mapProviderError, truncatedStream } from '../provider-error';
import type { FinishReason, UnifiedChatRequest, UnifiedChatResponse, UnifiedStreamChunk, UnifiedUsage } from '../unified.types';
import { fromOpenAIResponse, mapOpenAIFinishReason, toOpenAIRequest, toOpenAIStreamRequest } from './openai.mapper';

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

  async *stream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    try {
      const stream = await this.client.chat.completions.create(toOpenAIStreamRequest(request), { signal: request.signal });
      let finishReason: FinishReason | undefined;
      let usage: UnifiedUsage | null = null;
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (typeof choice?.delta.content === 'string' && choice.delta.content.length > 0) {
          yield { type: 'delta', text: choice.delta.content };
        }
        if (choice?.finish_reason) finishReason = mapOpenAIFinishReason(choice.finish_reason);
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }
      if (finishReason === undefined) throw truncatedStream('openai');
      yield { type: 'finish', finishReason, usage };
    } catch (error) {
      throw mapProviderError(error);
    }
  }
}
