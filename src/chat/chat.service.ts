import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ClientDisconnected } from '../common/errors/client-disconnected';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import { describeError } from '../common/filters/router-exception.filter';
import type { UnifiedUsage } from '../providers/unified.types';
import type { RoutingRequest } from '../routing/routing.service';
import { RoutingService } from '../routing/routing.service';
import { UsageRecord, UsageService, UsageStatus } from '../usage/usage.service';
import { ChatCompletionRequestDto, modelsFrom } from './dto/chat-completion-request.dto';
import { formatCompletion, formatDeltaChunk, formatFinishChunk, formatRoleChunk, OpenAIChatCompletion } from './openai-format';
import { SseWriter } from './sse-writer';

export interface ChatContext {
  requestId: string;
  apiKeyId: string;
  /** Aborted when the HTTP client goes away. Wired in the streaming phase. */
  clientSignal?: AbortSignal;
}

/**
 * Thin orchestration: build the routing request, call routing, record exactly
 * one usage row (success, error, or disconnect), log one summary line, format.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly routing: RoutingService,
    private readonly usage: UsageService,
    private readonly sse: SseWriter,
  ) {}

  async complete(dto: ChatCompletionRequestDto, context: ChatContext): Promise<OpenAIChatCompletion> {
    const request = routingRequest(dto, context);
    const { models } = request;
    const started = Date.now();

    try {
      const result = await this.routing.execute(request);
      const usage = result.response.usage;
      await this.finish(context, {
        model: result.publicModel,
        provider: result.provider,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        latencyMs: Date.now() - started,
        status: 'success',
        attempts: result.attempts,
      });
      return formatCompletion(context.requestId, result);
    } catch (error) {
      const status: UsageStatus =
        error instanceof ClientDisconnected
          ? 'client_disconnect'
          : `error:${error instanceof RouterError ? error.code : ErrorCode.INTERNAL_ERROR}`;
      const routerError = error instanceof RouterError ? error : undefined;
      await this.finish(context, {
        model: routerError?.model ?? models[0],
        provider: routerError?.provider ?? null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs: Date.now() - started,
        status,
        attempts: null,
      });
      throw error;
    }
  }

  async stream(dto: ChatCompletionRequestDto, context: ChatContext, response: Response): Promise<void> {
    const request = routingRequest(dto, context);
    const { models } = request;
    const started = Date.now();
    let model = models[0];
    let provider: string | null = null;
    let attempts: number | null = null;
    let usage: UnifiedUsage | null = null;
    let committed = false;
    try {
      const result = await this.routing.executeStream(request);
      model = result.publicModel;
      provider = result.provider;
      attempts = result.attempts;
      this.sse.start(response);
      committed = true;
      await this.sse.data(response, formatRoleChunk(context.requestId, model));
      for await (const item of result.chunks) {
        if (item.type === 'delta') {
          await this.sse.data(response, formatDeltaChunk(context.requestId, model, item.text));
        } else {
          usage = item.usage;
          await this.sse.data(response, formatFinishChunk(context.requestId, model, item.finishReason, item.usage));
        }
      }
      await this.sse.done(response);
      await this.finish(context, streamOutcome(model, provider, usage, Date.now() - started, 'success', attempts));
    } catch (error) {
      const routerError = error instanceof RouterError ? error : undefined;
      model = routerError?.model ?? model;
      provider = routerError?.provider ?? provider;
      const status: UsageStatus = error instanceof ClientDisconnected
        ? 'client_disconnect'
        : `error:${routerError?.code ?? ErrorCode.INTERNAL_ERROR}`;
      const outcome = streamOutcome(model, provider, usage, Date.now() - started, status, attempts);
      if (error instanceof ClientDisconnected) {
        await this.finish(context, outcome);
        return;
      }
      if (!committed) {
        await this.finish(context, outcome);
        throw error;
      }

      this.logStreamError(context.requestId, error);
      let writeFailure: unknown;
      try {
        await this.sse.error(response, error, context.requestId);
        response.end();
      } catch (frameError) {
        writeFailure = frameError;
      }
      // Do not make the client wait for the database before receiving the terminal error frame.
      await this.finish(context, outcome);
      if (writeFailure && !(writeFailure instanceof ClientDisconnected)) throw writeFailure;
    }
  }

  private logStreamError(requestId: string, error: unknown): void {
    const details = { request_id: requestId, msg: 'Committed stream failed', err: describeError(error) };
    if (!(error instanceof RouterError) || error.code === ErrorCode.INTERNAL_ERROR) this.logger.error(details);
    else this.logger.warn(details);
  }

  /** Writes the usage row and the summary log line. Never throws. */
  private async finish(
    context: ChatContext,
    outcome: Omit<UsageRecord, 'requestId' | 'apiKeyId'> & { attempts: number | null },
  ): Promise<void> {
    const { attempts, ...usage } = outcome;
    await this.usage.record({ requestId: context.requestId, apiKeyId: context.apiKeyId, ...usage });
    this.logger.log({
      msg: 'chat completion',
      request_id: context.requestId,
      model: usage.model,
      provider: usage.provider,
      status: usage.status,
      latency_ms: usage.latencyMs,
      attempts,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
    });
  }
}

function routingRequest(dto: ChatCompletionRequestDto, context: ChatContext): RoutingRequest {
  const models = modelsFrom(dto);
  if (!models) throw new RouterError(ErrorCode.INVALID_REQUEST, 'Provide exactly one of "model" or "models"');
  return {
    requestId: context.requestId,
    models,
    messages: dto.messages,
    maxTokens: dto.max_tokens,
    temperature: dto.temperature,
    topP: dto.top_p,
    stop: dto.stop,
    clientSignal: context.clientSignal,
  };
}

function streamOutcome(
  model: string,
  provider: string | null,
  usage: UnifiedUsage | null,
  latencyMs: number,
  status: UsageStatus,
  attempts: number | null,
): Omit<UsageRecord, 'requestId' | 'apiKeyId'> & { attempts: number | null } {
  return {
    model, provider,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    latencyMs, status, attempts,
  };
}
