import type { GenerateContentConfig, GenerateContentResponse } from '@google/genai';
import type { UnifiedChatRequest, UnifiedChatResponse } from '../unified.types';

export interface GoogleRequest {
  model: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  config?: GenerateContentConfig;
}

export function toGoogleRequest(request: UnifiedChatRequest): GoogleRequest {
  const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const config = compact({
    systemInstruction: system || undefined,
    maxOutputTokens: request.maxTokens,
    temperature: request.temperature,
    topP: request.topP,
    stopSequences: request.stop,
  }) as GenerateContentConfig;
  return {
    model: request.model,
    contents: request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
    ...(Object.keys(config).length ? { config } : {}),
  };
}

export function fromGoogleResponse(response: GenerateContentResponse): UnifiedChatResponse {
  const metadata = response.usageMetadata;
  const reason = response.candidates?.[0]?.finishReason;
  const blocked = response.promptFeedback?.blockReason !== undefined;
  const promptTokens = metadata?.promptTokenCount ?? 0;
  const completionTokens = metadata?.candidatesTokenCount ?? 0;
  return {
    content: response.text ?? '',
    finishReason: mapGoogleFinishReason(response),
    usage: metadata
      ? { promptTokens, completionTokens, totalTokens: metadata.totalTokenCount ?? promptTokens + completionTokens }
      : null,
  };
}

export function mapGoogleFinishReason(response: GenerateContentResponse): UnifiedChatResponse['finishReason'] {
  const reason = response.candidates?.[0]?.finishReason;
  const blocked = response.promptFeedback?.blockReason !== undefined;
  if (blocked || reason === 'SAFETY' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT') return 'content_filter';
  if (reason === 'MAX_TOKENS') return 'length';
  return 'stop';
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
