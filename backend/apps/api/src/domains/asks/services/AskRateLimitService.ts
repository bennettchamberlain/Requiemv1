import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';

import { checkSlidingWindow } from '../rateLimit';

/** Default: at most 20 asks per asker per rolling minute. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

/**
 * Per-asker sliding-window rate limit on the ask path — a first abuse control so
 * a single asker cannot flood a responder's review inbox. In-memory per process,
 * which is sufficient for the intra-Hub, single-instance Phase 0 surface; a
 * shared store can back it when the ask path goes multi-instance / federated.
 */
@Injectable()
export class AskRateLimitService {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(AskRateLimitService.name);
  }

  /**
   * Records an attempt for `userId` and throws HTTP 429 if the sliding-window
   * limit is exceeded. `now` is injectable for testing.
   */
  consume(userId: string, now: number = Date.now()): void {
    const previous = this.windows.get(userId) ?? [];
    const { kept, decision } = checkSlidingWindow(previous, now, WINDOW_MS, MAX_PER_WINDOW);
    this.windows.set(userId, kept);

    if (!decision.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many asks — please wait before sending another.',
          retryAfterMs: decision.retryAfterMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
