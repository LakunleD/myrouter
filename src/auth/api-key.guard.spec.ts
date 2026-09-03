import type { ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import type { RouterRequest } from '../common/router-request';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';

function contextFor(authorization?: string): { context: ExecutionContext; req: Partial<RouterRequest> } {
  const req: Partial<RouterRequest> = { headers: authorization ? { authorization } : {} } as Partial<RouterRequest>;
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { context, req };
}

describe('ApiKeyGuard', () => {
  let findActive: jest.Mock;
  let guard: ApiKeyGuard;

  beforeEach(() => {
    findActive = jest.fn();
    guard = new ApiKeyGuard({ findActive } as unknown as ApiKeyService);
  });

  async function expectInvalidKey(authorization?: string, message?: string): Promise<void> {
    const { context } = contextFor(authorization);
    const error = await guard.canActivate(context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RouterError);
    expect((error as RouterError).code).toBe(ErrorCode.INVALID_API_KEY);
    if (message) expect((error as RouterError).message).toBe(message);
  }

  it('rejects a missing header without touching the database', async () => {
    await expectInvalidKey(undefined, 'Missing or malformed Authorization header');
    expect(findActive).not.toHaveBeenCalled();
  });

  it('rejects a non-bearer scheme', async () => {
    await expectInvalidKey('Basic abc');
    expect(findActive).not.toHaveBeenCalled();
  });

  it('rejects unknown or revoked keys', async () => {
    findActive.mockResolvedValue(null);
    await expectInvalidKey('Bearer lr_unknown', 'Invalid or revoked API key');
    expect(findActive).toHaveBeenCalledWith('lr_unknown');
  });

  it('attaches the identity for a valid key', async () => {
    findActive.mockResolvedValue({ id: 'k1', name: 'dev' });
    const { context, req } = contextFor('Bearer lr_valid');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.apiKey).toEqual({ id: 'k1', name: 'dev' });
  });
});
