import type { Message, MessageCreateParamsNonStreaming, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { UnifiedChatRequest, UnifiedChatResponse } from '../unified.types';

export function toAnthropicRequest(request: UnifiedChatRequest): MessageCreateParamsNonStreaming {
  const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const messages: MessageParam[] = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }));
  return compact({
    model: request.model,
    max_tokens: request.maxTokens ?? 4096,
    system: system || undefined,
    messages,
    temperature: request.temperature,
    top_p: request.topP,
    stop_sequences: request.stop,
    stream: false,
  }) as MessageCreateParamsNonStreaming;
}

export function fromAnthropicResponse(response: Message): UnifiedChatResponse {
  const content = response.content
    .filter((block): block is Extract<(typeof response.content)[number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const input = response.usage.input_tokens;
  const output = response.usage.output_tokens;
  return {
    content,
    finishReason: response.stop_reason === 'max_tokens' ? 'length' : response.stop_reason === 'refusal' ? 'content_filter' : 'stop',
    usage: { promptTokens: input, completionTokens: output, totalTokens: input + output },
  };
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
