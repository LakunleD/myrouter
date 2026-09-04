import type { FinishReason, UnifiedUsage } from '../providers/unified.types';
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

export interface OpenAIChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: 'assistant'; content?: string };
    finish_reason: FinishReason | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function formatRoleChunk(requestId: string, model: string, now = Date.now()): OpenAIChatCompletionChunk {
  return chunk(requestId, model, { role: 'assistant' }, null, undefined, now);
}

export function formatDeltaChunk(requestId: string, model: string, content: string, now = Date.now()): OpenAIChatCompletionChunk {
  return chunk(requestId, model, { content }, null, undefined, now);
}

export function formatFinishChunk(
  requestId: string,
  model: string,
  finishReason: FinishReason,
  usage: UnifiedUsage | null,
  now = Date.now(),
): OpenAIChatCompletionChunk {
  return chunk(requestId, model, {}, finishReason, usage, now);
}

function chunk(
  id: string,
  model: string,
  delta: { role?: 'assistant'; content?: string },
  finishReason: FinishReason | null,
  usage: UnifiedUsage | null | undefined,
  now: number,
): OpenAIChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(now / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage: toOpenAIUsage(usage) } : {}),
  };
}

function toOpenAIUsage(usage: UnifiedUsage): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  return { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.totalTokens };
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
          usage: toOpenAIUsage(usage),
        }
      : {}),
  };
}
