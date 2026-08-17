import { Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { PlaceTransitionService } from '@ci/domains/daily-metrics';
import { UserService } from '@ci/domains/user';

export interface PlaceForecastItem {
  clusterId: string;
  lat: number;
  lng: number;
  visits: number;
  share: number;
  lastSeen: string | null;
  label: string | null;
  probability: number;
  backoffLevel: string | null;
}

/**
 * Forecast adapter over the 1729 stay-point / recency-decayed transition
 * engine. `share` is the model's probability (not a visit-count prior).
 * Rebuilds once on first read if the user has no clusters yet.
 */
@Injectable()
export class PlaceForecastService {
  /** Users already lazy-rebuilt in this process — avoid a 90-day rescan per Forecast load. */
  private readonly lazyRebuilt = new Set<string>();

  constructor(
    private readonly placeTransitionService: PlaceTransitionService,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaceForecastService.name);
  }

  async predictNext(
    context: UserServiceContext,
    k = 5,
    horizonHours = 4,
  ): Promise<PlaceForecastItem[]> {
    try {
      const timezone = await this.timezoneOf(context);
      let forecast = await this.placeTransitionService.predictNext(context, {
        k,
        horizonHours,
        timezone,
      });

      if (forecast.status === 'NO_HISTORY' && !this.lazyRebuilt.has(context.userId)) {
        this.lazyRebuilt.add(context.userId);
        await this.placeTransitionService.rebuild(context, { timezone });
        forecast = await this.placeTransitionService.predictNext(context, {
          k,
          horizonHours,
          timezone,
        });
      }

      return forecast.predictions.map((place) => ({
        clusterId: place.clusterId,
        lat: place.lat,
        lng: place.lng,
        visits: place.visitCount,
        share: place.probability,
        lastSeen: place.lastSeen ? place.lastSeen.toISOString() : null,
        label: place.label,
        probability: place.probability,
        backoffLevel: forecast.backoffLevel,
      }));
    } catch (error) {
      this.logger.warn('Place forecast failed', {
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return [];
    }
  }

  async rebuild(
    context: UserServiceContext,
    timezone = 'UTC',
  ): Promise<{ clusters: number; transitions: number }> {
    this.lazyRebuilt.add(context.userId);

    return this.placeTransitionService.rebuild(context, { timezone });
  }

  private async timezoneOf(context: UserServiceContext): Promise<string> {
    const user = await this.userService.findById(context, context.userId);

    return user?.timezone || 'UTC';
  }
}
