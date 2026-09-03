import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import type { RouterRequest } from '../common/router-request';
import { ApiKeyService } from './api-key.service';

const BEARER = /^Bearer\s+(\S+)$/i;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RouterRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    if (!match) {
      throw new RouterError(ErrorCode.INVALID_API_KEY, 'Missing or malformed Authorization header');
    }
    const identity = await this.apiKeys.findActive(match[1]);
    if (!identity) {
      throw new RouterError(ErrorCode.INVALID_API_KEY, 'Invalid or revoked API key');
    }
    req.apiKey = identity;
    return true;
  }
}
