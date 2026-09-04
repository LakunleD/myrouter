import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
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
  complete(@Body() dto: ChatCompletionRequestDto, @Req() request: RouterRequest): Promise<OpenAIChatCompletion> {
    return this.chat.complete(dto, contextFrom(request));
  }
}

function contextFrom(request: RouterRequest): ChatContext {
  if (!request.apiKey) {
    // The guard always sets this; reaching here means the route lost its guard.
    throw new RouterError(ErrorCode.INTERNAL_ERROR, 'Request has no API key identity');
  }
  return { requestId: request.requestId, apiKeyId: request.apiKey.id };
}
