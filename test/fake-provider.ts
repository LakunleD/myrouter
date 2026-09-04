import type { LLMProvider } from '../src/providers/llm-provider.interface';
import type {
  ProviderName,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamChunk,
} from '../src/providers/unified.types';

/** One scripted outcome. `hang` waits forever; with `honorSignal` it rejects when the signal aborts. */
export type FakeOutcome =
  | { response: UnifiedChatResponse }
  | { error: Error }
  | { chunks: Array<UnifiedStreamChunk | Error> }
  | { hang: true; honorSignal?: boolean };

export function okResponse(content = 'hello', tokens = { promptTokens: 3, completionTokens: 2 }): UnifiedChatResponse {
  return {
    content,
    finishReason: 'stop',
    usage: { ...tokens, totalTokens: tokens.promptTokens + tokens.completionTokens },
  };
}

export function okChunks(text = 'hello'): UnifiedStreamChunk[] {
  return [
    { type: 'delta', text },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } },
  ];
}

/**
 * Scripted LLMProvider for unit and e2e tests. Outcomes are consumed in order;
 * the last one repeats. Records every request and how many streams were closed.
 */
export class FakeProvider implements LLMProvider {
  readonly calls: UnifiedChatRequest[] = [];
  streamsClosed = 0;
  private cursor = 0;

  constructor(
    readonly name: ProviderName,
    private readonly outcomes: FakeOutcome[],
  ) {}

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    this.calls.push(request);
    const outcome = this.next();
    if ('response' in outcome) return outcome.response;
    if ('error' in outcome) throw outcome.error;
    if ('hang' in outcome) return hang(request.signal, outcome.honorSignal);
    throw new Error('FakeProvider: chat() called with a streaming outcome');
  }

  async *stream(request: UnifiedChatRequest): AsyncGenerator<UnifiedStreamChunk> {
    this.calls.push(request);
    const outcome = this.next();
    try {
      if ('error' in outcome) throw outcome.error;
      if ('hang' in outcome) {
        await hang(request.signal, outcome.honorSignal);
        return;
      }
      if ('response' in outcome) throw new Error('FakeProvider: stream() called with a chat outcome');
      for (const item of outcome.chunks) {
        if (item instanceof Error) throw item;
        if (item.type === 'delta' && item.text === '<hang>') {
          await hang(request.signal, true);
        }
        yield item;
      }
    } finally {
      this.streamsClosed += 1;
    }
  }

  private next(): FakeOutcome {
    const outcome = this.outcomes[Math.min(this.cursor, this.outcomes.length - 1)];
    this.cursor += 1;
    if (!outcome) throw new Error(`FakeProvider(${this.name}): no outcomes scripted`);
    return outcome;
  }
}

function hang<T = never>(signal: AbortSignal, honorSignal = false): Promise<T> {
  return new Promise<T>((_, reject) => {
    if (!honorSignal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
