import { generateRequestId } from './request-id';

describe('generateRequestId', () => {
  it('uses the lr_req_ prefix and is unique', () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).toMatch(/^lr_req_[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });
});
