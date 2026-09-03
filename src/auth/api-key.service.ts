import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { Database, DRIZZLE } from '../database/database.module';
import { apiKeys } from '../database/schema';
import type { ApiKeyIdentity } from '../common/router-request';

export const API_KEY_PREFIX = 'lr_';

@Injectable()
export class ApiKeyService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Keys are 32 random bytes, so a fast hash is enough: nothing to brute-force. */
  static hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  static generateKey(): string {
    return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  }

  /** Creates a key and returns the plaintext exactly once. Only the hash is stored. */
  async create(name: string): Promise<{ id: string; key: string }> {
    const key = ApiKeyService.generateKey();
    const [row] = await this.db
      .insert(apiKeys)
      .values({ name, keyHash: ApiKeyService.hash(key) })
      .returning({ id: apiKeys.id });
    return { id: row.id, key };
  }

  /** Resolves a plaintext key to its identity, or null when unknown or revoked. */
  async findActive(key: string): Promise<ApiKeyIdentity | null> {
    if (!key.startsWith(API_KEY_PREFIX)) return null;
    const [row] = await this.db
      .select({ id: apiKeys.id, name: apiKeys.name })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, ApiKeyService.hash(key)), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row ?? null;
  }
}
