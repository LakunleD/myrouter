import { Injectable, Logger } from '@nestjs/common';
import { ClientDisconnected } from '../common/errors/client-disconnected';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import type { RoutingRequest } from '../routing/routing.service';
import { RoutingService } from '../routing/routing.service';
import { UsageRecord, UsageService, UsageStatus } from '../usage/usage.service';
import { ChatCompletionRequestDto, modelsFrom } from './dto/chat-completion-request.dto';
import { formatCompletion, OpenAIChatCompletion } from './openai-format';

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
  ) {}

  async complete(dto: ChatCompletionRequestDto, context: ChatContext): Promise<OpenAIChatCompletion> {
    if (dto.stream) {
      throw new RouterError(ErrorCode.INVALID_REQUEST, 'Streaming is not available yet');
    }
    const models = modelsFrom(dto);
    if (!models) {
      throw new RouterError(ErrorCode.INVALID_REQUEST, 'Provide exactly one of "model" or "models"');
    }

    const request: RoutingRequest = {
      requestId: context.requestId,
      models,
      messages: dto.messages,
      maxTokens: dto.max_tokens,
      temperature: dto.temperature,
      topP: dto.top_p,
      stop: dto.stop,
      clientSignal: context.clientSignal,
    };
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
