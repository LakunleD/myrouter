import { Logger } from '@nestjs/common';
import { UsageRecord, UsageService } from './usage.service';

const record: UsageRecord = {
  requestId: 'lr_req_1',
  apiKeyId: 'key-1',
  model: 'openai/gpt-5',
  provider: 'openai',
  promptTokens: 3,
  completionTokens: 2,
  totalTokens: 5,
  latencyMs: 42,
  status: 'success',
};

describe('UsageService', () => {
  it('inserts one row mapped to the schema columns', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const db = { insert: jest.fn(() => ({ values })) };
    await new UsageService(db as never).record(record);
    expect(values).toHaveBeenCalledWith({
      requestId: 'lr_req_1',
      apiKeyId: 'key-1',
      model: 'openai/gpt-5',
      provider: 'openai',
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
      latencyMs: 42,
      status: 'success',
    });
  });

  it('logs and swallows database failures', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const db = { insert: jest.fn(() => ({ values: jest.fn().mockRejectedValue(new Error('db down')) })) };
    await expect(new UsageService(db as never).record(record)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'lr_req_1' }));
  });
});
