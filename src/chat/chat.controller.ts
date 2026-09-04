import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import type { RouterRequest } from '../common/router-request';
import { ChatContext, ChatService } from './chat.service';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';
import type { OpenAIChatCompletion } from './openai-format';

@Controller('v1/chat')
@UseGuards(ApiKeyGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('completions')
  @HttpCode(200)
  async complete(
    @Body() dto: ChatCompletionRequestDto,
    @Req() request: RouterRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OpenAIChatCompletion | void> {
    const client = new AbortController();
    const disconnect = (): void => {
      if (!response.writableEnded) client.abort();
    };
    response.once('close', disconnect);
    try {
      const context = { ...contextFrom(request), clientSignal: client.signal };
      if (dto.stream) return await this.chat.stream(dto, context, response);
      return await this.chat.complete(dto, context);
    } finally {
      response.off('close', disconnect);
    }
  }
}

function contextFrom(request: RouterRequest): ChatContext {
  if (!request.apiKey) {
    // The guard always sets this; reaching here means the route lost its guard.
    throw new RouterError(ErrorCode.INTERNAL_ERROR, 'Request has no API key identity');
  }
  return { requestId: request.requestId, apiKeyId: request.apiKey.id };
}
