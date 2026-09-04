export type AbortCause = 'timeout' | 'client_disconnect';

export class AttemptAborted extends Error {
  constructor(readonly abortCause: AbortCause) {
    super(`Attempt aborted: ${abortCause}`);
    this.name = 'AttemptAborted';
  }
}

/**
 * One AbortSignal per provider attempt. It fires on a (re-armable) timeout or
 * when the HTTP client's own signal aborts, and remembers which happened first.
 */
export class AttemptController {
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private cause: AbortCause | undefined;
  private readonly onClientAbort = (): void => this.abort('client_disconnect');

  constructor(private readonly clientSignal?: AbortSignal) {
    if (clientSignal?.aborted) {
      this.abort('client_disconnect');
    } else {
      clientSignal?.addEventListener('abort', this.onClientAbort, { once: true });
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get abortCause(): AbortCause | undefined {
    return this.cause;
  }

  /** Starts (or restarts) the timeout. Used once per non-streaming call and once per streamed chunk. */
  arm(ms: number): void {
    this.disarm();
    this.timer = setTimeout(() => this.abort('timeout'), ms);
  }

  disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.disarm();
    this.clientSignal?.removeEventListener('abort', this.onClientAbort);
  }

  private abort(cause: AbortCause): void {
    if (this.cause) return;
    this.cause = cause;
    this.disarm();
    this.controller.abort(new AttemptAborted(cause));
  }
}

/**
 * Settles as soon as either the promise settles or the signal aborts, so a
 * provider SDK that ignores its signal cannot hold an attempt open forever.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
