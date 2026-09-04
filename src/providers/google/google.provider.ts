import { GoogleGenAI } from '@google/genai';
import type { LLMProvider } from '../llm-provider.interface';
import { mapProviderError } from '../provider-error';
import type { UnifiedChatRequest, UnifiedChatResponse, UnifiedStreamChunk } from '../unified.types';
import { fromGoogleResponse, toGoogleRequest } from './google.mapper';

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

  async *stream(_request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    throw new Error('Google streaming is implemented in Phase 6');
  }
}
