import { Inject, Injectable } from '@nestjs/common';
import { ClientDisconnected } from '../common/errors/client-disconnected';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ModelRegistryService } from '../models/model-registry.service';
import type { LLMProvider } from '../providers/llm-provider.interface';
import { ProviderRegistry } from '../providers/provider-registry';
import type {
  ProviderName,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedMessage,
  UnifiedStreamChunk,
} from '../providers/unified.types';
import { AttemptController, raceAbort } from './attempt-signal';
import { Attempt, FallbackService } from './fallback.service';

export const MAX_MODELS = 2;

export interface RoutingRequest {
  requestId: string;
  /** Public aliases in preference order: one, or two for fallback. */
  models: string[];
  messages: UnifiedMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  /** Aborted when the HTTP client goes away. */
  clientSignal?: AbortSignal;
}

export interface RoutingResult {
  publicModel: string;
  provider: ProviderName;
  attempts: number;
  response: UnifiedChatResponse;
}

export interface RoutingStreamResult {
  publicModel: string;
  provider: ProviderName;
  attempts: number;
  /** Committed: the first upstream chunk has already arrived and is yielded first. */
  chunks: AsyncIterable<UnifiedStreamChunk>;
}

/**
 * Owns model resolution, provider selection, per-attempt timeouts, and the
 * fallback loop. ChatService only calls execute()/executeStream().
 */
@Injectable()
export class RoutingService {
  constructor(
    private readonly models: ModelRegistryService,
    private readonly providers: ProviderRegistry,
    private readonly fallback: FallbackService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Resolves every alias up front so an unknown one fails before any provider call. */
  plan(models: string[]): Attempt[] {
    if (models.length === 0) {
      throw new RouterError(ErrorCode.INVALID_REQUEST, 'At least one model is required');
    }
    if (models.length > MAX_MODELS) {
      throw new RouterError(ErrorCode.INVALID_REQUEST, `Maximum of ${MAX_MODELS} models allowed`);
    }
    return models.map((alias) => {
      const entry = this.models.resolve(alias);
      if (!entry) {
        throw new RouterError(ErrorCode.MODEL_NOT_FOUND, `Model '${alias}' not found`, { model: alias });
      }
      return { publicModel: alias, provider: entry.provider, upstreamModel: entry.upstreamModel };
    });
  }

  async execute(request: RoutingRequest): Promise<RoutingResult> {
    const plan = this.plan(request.models);
    const outcome = await this.fallback.run(request.requestId, plan, async (attempt) => {
      const provider = this.providerFor(attempt);
      const controller = new AttemptController(request.clientSignal);
      controller.arm(this.config.providerTimeoutMs);
      try {
        const unified = this.toUnified(request, attempt, controller.signal);
        return await raceAbort(provider.chat(unified), controller.signal);
      } catch (error) {
        throw this.classify(error, controller, attempt);
      } finally {
        controller.dispose();
      }
    });
    return {
      publicModel: outcome.attempt.publicModel,
      provider: outcome.attempt.provider,
      attempts: outcome.attempts,
      response: outcome.value,
    };
  }

  async executeStream(request: RoutingRequest): Promise<RoutingStreamResult> {
    const plan = this.plan(request.models);
    const outcome = await this.fallback.run(request.requestId, plan, (attempt) => this.startStream(request, attempt));
    return {
      publicModel: outcome.attempt.publicModel,
      provider: outcome.attempt.provider,
      attempts: outcome.attempts,
      chunks: outcome.value,
    };
  }

  /**
   * Starts one streaming attempt and waits for its first chunk. Any failure
   * before that point is thrown here, inside the fallback loop. After it, the
   * attempt is committed and later failures surface from the returned iterable.
   */
  private async startStream(request: RoutingRequest, attempt: Attempt): Promise<AsyncIterable<UnifiedStreamChunk>> {
    const provider = this.providerFor(attempt);
    const controller = new AttemptController(request.clientSignal);
    controller.arm(this.config.streamFirstChunkTimeoutMs);
    const iterator = provider.stream(this.toUnified(request, attempt, controller.signal))[Symbol.asyncIterator]();

    let first: IteratorResult<UnifiedStreamChunk>;
    try {
      first = await raceAbort(iterator.next(), controller.signal);
    } catch (error) {
      controller.dispose();
      await closeQuietly(iterator, controller);
      throw this.classify(error, controller, attempt);
    }
    if (first.done) {
      controller.dispose();
      throw new RouterError(ErrorCode.PROVIDER_UNAVAILABLE, 'Provider ended the stream without content', {
        provider: attempt.provider,
        model: attempt.publicModel,
      });
    }
    return this.continueStream(first.value, iterator, controller, attempt);
  }

  private async *continueStream(
    first: UnifiedStreamChunk,
    iterator: AsyncIterator<UnifiedStreamChunk>,
    controller: AttemptController,
    attempt: Attempt,
  ): AsyncGenerator<UnifiedStreamChunk> {
    try {
      yield first;
      for (;;) {
        controller.arm(this.config.streamIdleTimeoutMs);
        const next = await raceAbort(iterator.next(), controller.signal);
        if (next.done) return;
        yield next.value;
      }
    } catch (error) {
      throw this.classify(error, controller, attempt);
    } finally {
      controller.dispose();
      await closeQuietly(iterator, controller);
    }
  }

  private providerFor(attempt: Attempt): LLMProvider {
    const provider = this.providers.get(attempt.provider);
    if (!provider) {
      throw new RouterError(ErrorCode.PROVIDER_UNAVAILABLE, `Provider '${attempt.provider}' is not configured`, {
        provider: attempt.provider,
        model: attempt.publicModel,
      });
    }
    return provider;
  }

  private toUnified(request: RoutingRequest, attempt: Attempt, signal: AbortSignal): UnifiedChatRequest {
    return {
      requestId: request.requestId,
      model: attempt.upstreamModel,
      messages: request.messages,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      topP: request.topP,
      stop: request.stop,
      signal,
    };
  }

  /** Turns whatever an attempt threw into the one error the rest of the system understands. */
  private classify(error: unknown, controller: AttemptController, attempt: Attempt): Error {
    const stamp = { provider: attempt.provider, model: attempt.publicModel, cause: error };
    if (controller.abortCause === 'client_disconnect' || error instanceof ClientDisconnected) {
      return new ClientDisconnected();
    }
    if (controller.abortCause === 'timeout') {
      return new RouterError(ErrorCode.PROVIDER_TIMEOUT, undefined, stamp);
    }
    if (error instanceof RouterError) {
      error.provider ??= attempt.provider;
      error.model ??= attempt.publicModel;
      return error;
    }
    return new RouterError(ErrorCode.INTERNAL_ERROR, undefined, stamp);
  }
}

/**
 * Releases the provider stream. When the attempt was aborted (timeout or
 * client disconnect) the signal has already told the stream to stop, and a
 * stream that ignores its signal would block `return()` behind its pending
 * `next()`, so in that case the close is not awaited.
 */
async function closeQuietly(iterator: AsyncIterator<unknown>, controller: AttemptController): Promise<void> {
  const closing = Promise.resolve()
    .then(() => iterator.return?.())
    .then(
      () => undefined,
      () => undefined,
    );
  if (controller.abortCause === undefined) {
    await closing;
  }
}
