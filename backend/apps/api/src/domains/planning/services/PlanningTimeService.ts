import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { UserEntity } from '@ci/domains/user';

import {
  isValidTimezone,
  localDateInTZ,
  todayInTZ,
  utcDayBounds,
  utcToZonedWallTime,
  zonedWallTimeToUTC,
} from '../time/zoned';

const FALLBACK_TIMEZONE = 'UTC';

/**
 * The imperative shell around `time/zoned.ts`: resolves a user's IANA zone and
 * delegates. The arithmetic itself stays pure and is tested without a database.
 *
 * `ci.users.timezone` is the single source of truth. Planning deliberately has
 * no timezone column of its own — two sources of truth for a user's zone, in
 * code whose correctness is DST-sensitive, is a bug factory.
 */
@Injectable()
export class PlanningTimeService {
  private readonly cache = new Map<string, string>();

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlanningTimeService.name);
  }

  /**
   * The user's IANA zone, falling back to UTC when unset or unrecognised.
   *
   * Cached per user for the process lifetime: a zone change is rare and takes
   * effect on the next boot, which is the same contract
   * `ForecastContextService` has today.
   */
  async timezoneFor(userId: string): Promise<string> {
    const cached = this.cache.get(userId);

    if (cached != null) {
      return cached;
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, timezone: true },
    });
    const raw = user?.timezone?.trim();
    let timezone = FALLBACK_TIMEZONE;

    if (raw && isValidTimezone(raw)) {
      timezone = raw;
    } else if (raw) {
      this.logger.warn(`Unrecognised timezone "${raw}" for user ${userId}; falling back to UTC`);
    }

    this.cache.set(userId, timezone);

    return timezone;
  }

  /** Drops a cached zone so a preference change takes effect immediately. */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /** Today's calendar date (`YYYY-MM-DD`) in the caller's zone. */
  async today(context: UserServiceContext, now: Date = new Date()): Promise<string> {
    return todayInTZ(await this.timezoneFor(context.userId), now);
  }

  /** The caller-local calendar date (`YYYY-MM-DD`) of a UTC instant. */
  async localDate(context: UserServiceContext, instant: Date): Promise<string> {
    return localDateInTZ(instant, await this.timezoneFor(context.userId));
  }

  /** The caller-local wall-clock `HH:MM` of a UTC instant. */
  async wallTime(context: UserServiceContext, instant: Date): Promise<string> {
    return utcToZonedWallTime(instant, await this.timezoneFor(context.userId));
  }

  /**
   * The UTC instant for a caller-local wall clock. `date` is `YYYY-MM-DD` and
   * `time` is `HH:MM` — both zoneless by construction.
   */
  async toInstant(context: UserServiceContext, date: string, time: string): Promise<Date> {
    return zonedWallTimeToUTC(date, time, await this.timezoneFor(context.userId));
  }

  /** `[start, end)` UTC bounds of a caller-local calendar day. */
  async dayBounds(context: UserServiceContext, date: string): Promise<{ start: Date; end: Date }> {
    return utcDayBounds(date, await this.timezoneFor(context.userId));
  }
}
