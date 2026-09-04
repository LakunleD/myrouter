import type { Message, MessageCreateParamsNonStreaming, MessageCreateParamsStreaming, MessageParam, StopReason } from '@anthropic-ai/sdk/resources/messages';
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

export function toAnthropicStreamRequest(request: UnifiedChatRequest): MessageCreateParamsStreaming {
  return { ...toAnthropicRequest(request), stream: true };
}

export function mapAnthropicFinishReason(reason: StopReason | null): UnifiedChatResponse['finishReason'] {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'refusal') return 'content_filter';
  return 'stop';
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
    finishReason: mapAnthropicFinishReason(response.stop_reason),
    usage: { promptTokens: input, completionTokens: output, totalTokens: input + output },
  };
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
