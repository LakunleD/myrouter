import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { UnifiedChatRequest, UnifiedChatResponse } from '../unified.types';

/**
 * `max_completion_tokens` replaces the deprecated `max_tokens`, which reasoning
 * models such as GPT-5 reject outright.
 */
export function toOpenAIRequest(request: UnifiedChatRequest): ChatCompletionCreateParamsNonStreaming {
  return compact({
    model: request.model,
    messages: request.messages,
    max_completion_tokens: request.maxTokens,
    temperature: request.temperature,
    top_p: request.topP,
    stop: request.stop,
    stream: false,
  }) as ChatCompletionCreateParamsNonStreaming;
}

export function fromOpenAIResponse(response: ChatCompletion): UnifiedChatResponse {
  const choice = response.choices[0];
  return {
    content: typeof choice?.message.content === 'string' ? choice.message.content : '',
    finishReason: mapOpenAIFinishReason(choice?.finish_reason),
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
  };
}

export function mapOpenAIFinishReason(reason: string | null | undefined): UnifiedChatResponse['finishReason'] {
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'content_filter';
  return 'stop';
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
