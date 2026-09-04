export type ProviderName = 'openai' | 'anthropic' | 'google';

export const PROVIDER_NAMES: readonly ProviderName[] = ['openai', 'anthropic', 'google'];

export interface UnifiedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Provider-neutral request. `model` is already the upstream id. */
export interface UnifiedChatRequest {
  requestId: string;
  model: string;
  messages: UnifiedMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  /** Aborted on attempt timeout or client disconnect. Adapters must pass it to the SDK. */
  signal: AbortSignal;
}

export type FinishReason = 'stop' | 'length' | 'content_filter';

export interface UnifiedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UnifiedChatResponse {
  content: string;
  finishReason: FinishReason;
  usage: UnifiedUsage | null;
}

export type UnifiedStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'finish'; finishReason: FinishReason; usage: UnifiedUsage | null };
