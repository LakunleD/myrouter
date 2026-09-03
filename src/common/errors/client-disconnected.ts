/**
 * Thrown inside an attempt when the HTTP client closed its socket. It is not a
 * RouterError: nothing can be sent back, and it must never trigger fallback.
 */
export class ClientDisconnected extends Error {
  constructor() {
    super('Client disconnected');
    this.name = 'ClientDisconnected';
  }
}
