import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

export interface PlaceForecastItem {
  lat: number;
  lng: number;
  visits: number;
  share: number;
  lastSeen: string | null;
}

/**
 * Lightweight next-place prior: recent stay cells from ci.position, ranked by
 * visit count. The 1729 Markov engine can replace this once stay-point tables
 * land; Forecast can already show a useful list.
 */
@Injectable()
export class PlaceForecastService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaceForecastService.name);
  }

  async predictNext(context: UserServiceContext, k = 5): Promise<PlaceForecastItem[]> {
    const limit = Math.min(20, Math.max(1, k));

    try {
      const rows = (await this.dataSource.query(
        `
        SELECT
          round(ST_Y(location::geometry)::numeric, 3)::float AS lat,
          round(ST_X(location::geometry)::numeric, 3)::float AS lng,
          count(*)::int AS visits,
          max(time) AS last_seen
        FROM ci.position
        WHERE user_id = $1
          AND location IS NOT NULL
          AND time > now() - interval '30 days'
        GROUP BY 1, 2
        ORDER BY visits DESC
        LIMIT $2
        `,
        [context.userId, limit],
      )) as Array<{ lat: number; lng: number; visits: number; last_seen: Date | string | null }>;

      const total = rows.reduce((sum, row) => sum + Number(row.visits), 0) || 1;

      return rows.map((row) => ({
        lat: Number(row.lat),
        lng: Number(row.lng),
        visits: Number(row.visits),
        share: Number(row.visits) / total,
        lastSeen: row.last_seen
          ? row.last_seen instanceof Date
            ? row.last_seen.toISOString()
            : String(row.last_seen)
          : null,
      }));
    } catch (error) {
      this.logger.warn('Place forecast failed', {
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return [];
    }
  }
}
