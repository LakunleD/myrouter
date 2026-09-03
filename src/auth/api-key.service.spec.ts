import { ApiKeyService } from './api-key.service';

describe('ApiKeyService statics', () => {
  it('generates keys with the lr_ prefix and 32 bytes of entropy', () => {
    const key = ApiKeyService.generateKey();
    expect(key).toMatch(/^lr_[A-Za-z0-9_-]{43}$/);
    expect(ApiKeyService.generateKey()).not.toBe(key);
  });

  it('hashes deterministically with sha256', () => {
    const key = 'lr_test';
    expect(ApiKeyService.hash(key)).toHaveLength(64);
    expect(ApiKeyService.hash(key)).toBe(ApiKeyService.hash(key));
    expect(ApiKeyService.hash(key)).not.toBe(ApiKeyService.hash('lr_other'));
  });
});

describe('ApiKeyService.findActive', () => {
  it('short-circuits on a key without the prefix', async () => {
    const select = jest.fn();
    const service = new ApiKeyService({ select } as never);
    await expect(service.findActive('sk-not-ours')).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });
});
