import type { ProviderName, UnifiedChatRequest, UnifiedChatResponse, UnifiedStreamChunk } from './unified.types';

/**
 * The contract every adapter implements. Adapters know nothing about public
 * aliases; ModelRegistry decides which adapter serves which alias.
 */
export interface LLMProvider {
  readonly name: ProviderName;
  chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  stream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk>;
}
