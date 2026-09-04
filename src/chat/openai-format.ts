import type { RoutingResult } from '../routing/routing.service';

export interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop' | 'length' | 'content_filter';
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function formatCompletion(requestId: string, result: RoutingResult, now = Date.now()): OpenAIChatCompletion {
  const usage = result.response.usage;
  return {
    id: requestId,
    object: 'chat.completion',
    created: Math.floor(now / 1000),
    model: result.publicModel,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: result.response.content },
        finish_reason: result.response.finishReason,
      },
    ],
    ...(usage
      ? {
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.totalTokens,
          },
        }
      : {}),
  };
}
