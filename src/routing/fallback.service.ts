import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-code';
import { RouterError } from '../common/errors/router-error';
import type { ProviderName } from '../providers/unified.types';

export interface Attempt {
  publicModel: string;
  provider: ProviderName;
  upstreamModel: string;
}

export interface FallbackOutcome<T> {
  value: T;
  attempt: Attempt;
  attempts: number;
}

/**
 * The retry rule, and nothing else: try the plan in order, move to the next
 * entry only when the failure is a retryable RouterError and an entry remains.
 */
@Injectable()
export class FallbackService {
  private readonly logger = new Logger(FallbackService.name);

  async run<T>(
    requestId: string,
    plan: Attempt[],
    attemptFn: (attempt: Attempt, index: number) => Promise<T>,
  ): Promise<FallbackOutcome<T>> {
    if (plan.length === 0) {
      throw new RouterError(ErrorCode.INTERNAL_ERROR, 'Routing plan is empty');
    }
    for (let index = 0; index < plan.length; index += 1) {
      const attempt = plan[index];
      try {
        const value = await attemptFn(attempt, index);
        return { value, attempt, attempts: index + 1 };
      } catch (error) {
        const next = plan[index + 1];
        if (next && error instanceof RouterError && error.retryable) {
          this.logger.warn({
            msg: 'Falling back to next model',
            request_id: requestId,
            from_model: attempt.publicModel,
            to_model: next.publicModel,
            code: error.code,
            upstream_status: error.upstreamStatus,
          });
          continue;
        }
        throw error;
      }
    }
    // Unreachable: the loop either returns or throws on the last entry.
    throw new RouterError(ErrorCode.INTERNAL_ERROR, 'Fallback loop exited without a result');
  }
}
