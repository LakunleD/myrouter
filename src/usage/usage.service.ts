import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ErrorCode } from '../common/errors/error-code';
import { describeError } from '../common/filters/router-exception.filter';
import { Database, DRIZZLE } from '../database/database.module';
import { usage } from '../database/schema';

export type UsageStatus = 'success' | 'client_disconnect' | `error:${ErrorCode}`;

export interface UsageRecord {
  requestId: string;
  apiKeyId: string;
  /** Public alias that served, or the last one attempted. */
  model: string;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  status: UsageStatus;
}

/** One row per chat request. Never throws: a usage failure must not change the response. */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async record(record: UsageRecord): Promise<void> {
    try {
      await this.db.insert(usage).values({
        requestId: record.requestId,
        apiKeyId: record.apiKeyId,
        model: record.model,
        provider: record.provider,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens: record.totalTokens,
        latencyMs: record.latencyMs,
        status: record.status,
      });
    } catch (error) {
      this.logger.error({ msg: 'Failed to record usage', request_id: record.requestId, err: describeError(error) });
    }
  }
}
