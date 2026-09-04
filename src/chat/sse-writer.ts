import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ClientDisconnected } from '../common/errors/client-disconnected';
import { errorBody, normalizeError } from '../common/filters/router-exception.filter';

@Injectable()
export class SseWriter {
  start(response: Response): void {
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
  }

  async data(response: Response, value: unknown): Promise<void> {
    await this.write(response, `data: ${JSON.stringify(value)}\n\n`);
  }

  async error(response: Response, exception: unknown, requestId: string): Promise<void> {
    await this.data(response, errorBody(normalizeError(exception), requestId));
  }

  async done(response: Response): Promise<void> {
    await this.write(response, 'data: [DONE]\n\n');
    response.end();
  }

  private async write(response: Response, frame: string): Promise<void> {
    if (response.destroyed || response.writableEnded) throw new ClientDisconnected();
    if (!response.write(frame)) {
      await waitForDrain(response);
    }
  }
}

/** Waits for writable capacity and always removes the losing event listener. */
function waitForDrain(response: Response): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      response.off('drain', onDrain);
      response.off('close', onClose);
      response.off('error', onError);
    };
    const onDrain = (): void => { cleanup(); resolve(); };
    const onClose = (): void => { cleanup(); reject(new ClientDisconnected()); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    response.once('drain', onDrain);
    response.once('close', onClose);
    response.once('error', onError);
  });
}
