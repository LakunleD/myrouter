import { GoogleGenAI } from '@google/genai';
import type { LLMProvider } from '../llm-provider.interface';
import { mapProviderError } from '../provider-error';
import type { FinishReason, UnifiedChatRequest, UnifiedChatResponse, UnifiedStreamChunk, UnifiedUsage } from '../unified.types';
import { fromGoogleResponse, mapGoogleFinishReason, toGoogleRequest } from './google.mapper';

export class GoogleProvider implements LLMProvider {
  readonly name = 'google' as const;

  constructor(private readonly client: GoogleGenAI) {}

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const params = toGoogleRequest(request);
    try {
      const response = await this.client.models.generateContent({
        ...params,
        config: { ...params.config, abortSignal: request.signal },
      });
      return fromGoogleResponse(response);
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  async *stream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    const params = toGoogleRequest(request);
    try {
      const stream = await this.client.models.generateContentStream({
        ...params,
        config: { ...params.config, abortSignal: request.signal },
      });
      let finishReason: FinishReason = 'stop';
      let usage: UnifiedUsage | null = null;
      for await (const chunk of stream) {
        if (chunk.text) yield { type: 'delta', text: chunk.text };
        if (chunk.promptFeedback?.blockReason !== undefined || chunk.candidates?.[0]?.finishReason !== undefined) {
          finishReason = mapGoogleFinishReason(chunk);
        }
        const metadata = chunk.usageMetadata;
        if (metadata) {
          const promptTokens = metadata.promptTokenCount ?? 0;
          const completionTokens = metadata.candidatesTokenCount ?? 0;
          usage = { promptTokens, completionTokens, totalTokens: metadata.totalTokenCount ?? promptTokens + completionTokens };
        }
      }
      yield { type: 'finish', finishReason, usage };
    } catch (error) {
      throw mapProviderError(error);
    }
  }
}
