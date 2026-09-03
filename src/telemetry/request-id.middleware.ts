import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { RouterRequest } from '../common/router-request';
import { generateRequestId, REQUEST_ID_HEADER } from './request-id';

/** Runs before guards, pipes, and filters so every response and log line carries the id. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id = generateRequestId();
    (req as RouterRequest).requestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}
