import { randomBytes } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

export function generateRequestId(): string {
  return `lr_req_${randomBytes(16).toString('base64url')}`;
}
