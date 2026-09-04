import { AttemptAborted, AttemptController, raceAbort } from './attempt-signal';

describe('AttemptController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts with cause timeout when the armed timer fires', () => {
    const attempt = new AttemptController();
    attempt.arm(100);
    jest.advanceTimersByTime(99);
    expect(attempt.signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.abortCause).toBe('timeout');
    expect(attempt.signal.reason).toBeInstanceOf(AttemptAborted);
  });

  it('re-arming pushes the deadline out', () => {
    const attempt = new AttemptController();
    attempt.arm(100);
    jest.advanceTimersByTime(80);
    attempt.arm(100);
    jest.advanceTimersByTime(80);
    expect(attempt.signal.aborted).toBe(false);
    jest.advanceTimersByTime(20);
    expect(attempt.abortCause).toBe('timeout');
  });

  it('aborts with cause client_disconnect when the client signal fires, and keeps the first cause', () => {
    const client = new AbortController();
    const attempt = new AttemptController(client.signal);
    attempt.arm(100);
    client.abort();
    expect(attempt.abortCause).toBe('client_disconnect');
    jest.advanceTimersByTime(100);
    expect(attempt.abortCause).toBe('client_disconnect');
  });

  it('is aborted immediately when the client signal was already aborted', () => {
    const client = new AbortController();
    client.abort();
    const attempt = new AttemptController(client.signal);
    expect(attempt.abortCause).toBe('client_disconnect');
  });

  it('dispose stops the timer and detaches from the client signal', () => {
    const client = new AbortController();
    const attempt = new AttemptController(client.signal);
    attempt.arm(100);
    attempt.dispose();
    jest.advanceTimersByTime(100);
    client.abort();
    expect(attempt.signal.aborted).toBe(false);
  });
});

describe('raceAbort', () => {
  it('resolves with the promise value when it settles first', async () => {
    const attempt = new AttemptController();
    await expect(raceAbort(Promise.resolve(42), attempt.signal)).resolves.toBe(42);
  });

  it('rejects with the abort reason when the signal fires first', async () => {
    const attempt = new AttemptController();
    const never = new Promise<number>(() => undefined);
    const racing = raceAbort(never, attempt.signal);
    attempt.arm(1);
    await expect(racing).rejects.toBeInstanceOf(AttemptAborted);
  });

  it('rejects immediately on an already-aborted signal', async () => {
    const attempt = new AttemptController();
    attempt.arm(0);
    await new Promise((r) => setTimeout(r, 5));
    await expect(raceAbort(Promise.resolve(1), attempt.signal)).rejects.toBeInstanceOf(AttemptAborted);
  });
});
