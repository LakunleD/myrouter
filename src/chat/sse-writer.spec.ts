import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { SseWriter } from './sse-writer';

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  frames: string[] = [];
  status = jest.fn(() => this);
  set = jest.fn(() => this);
  flushHeaders = jest.fn();
  end = jest.fn(() => { this.writableEnded = true; });
  write = jest.fn((frame: string) => { this.frames.push(frame); return true; });
}

describe('SseWriter', () => {
  it('sets SSE headers and writes JSON plus the literal done marker', async () => {
    const response = new FakeResponse();
    const writer = new SseWriter();
    writer.start(response as unknown as Response);
    await writer.data(response as unknown as Response, { hello: 'world' });
    await writer.done(response as unknown as Response);
    expect(response.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'text/event-stream; charset=utf-8' }));
    expect(response.frames).toEqual(['data: {"hello":"world"}\n\n', 'data: [DONE]\n\n']);
    expect(response.end).toHaveBeenCalled();
  });

  it('waits for drain after backpressure', async () => {
    const response = new FakeResponse();
    response.write.mockImplementationOnce((frame: string) => { response.frames.push(frame); return false; });
    const pending = new SseWriter().data(response as unknown as Response, { x: 1 });
    queueMicrotask(() => response.emit('drain'));
    await pending;
    expect(response.listenerCount('close')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
  });

  it('rejects with ClientDisconnected and removes listeners when the socket closes during backpressure', async () => {
    const response = new FakeResponse();
    response.write.mockReturnValueOnce(false);
    const pending = new SseWriter().data(response as unknown as Response, { x: 1 });
    queueMicrotask(() => response.emit('close'));
    await expect(pending).rejects.toMatchObject({ name: 'ClientDisconnected' });
    expect(response.listenerCount('drain')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
  });
});
