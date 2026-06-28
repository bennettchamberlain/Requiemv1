import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';

/**
 * Default physical-presence `source_system`s eligible for temporal location
 * estimation — events that represent the user BEING somewhere. Messages and
 * social posts are deliberately excluded: a post/email carries no inherent
 * "where I was", so estimating its location would pollute the map and the
 * home/work clustering (a 3am email must not snap to yesterday's restaurant).
 */
export const DEFAULT_ESTIMATE_SOURCE_SYSTEMS: readonly string[] = [
  'calendar',
  'apple_photos',
  'google_photos',
  'apple_health',
  'google_fit',
  'fitbit',
  'strava',
  'garmin',
  'withings',
  'uber',
  'lyft',
  'flighty',
  'amazon',
  'paypal',
  'venmo',
  'google_purchases',
  'google_maps_places',
  'google_location',
];

/** Default max gap (hours) between a candidate event and its donor location. */
export const DEFAULT_MAX_GAP_HOURS = 24;

/**
 * Estimated coordinates carry low confidence so HBPE / RAG / known-place
 * clustering discount them relative to measured or geocoded coordinates.
 */
export const ESTIMATED_CONFIDENCE = 0.4;

export interface EstimateBatchOptions {
  /** Max coordinate-less candidates to fill in this batch. */
  limit: number;
  /** Max time gap (hours) between a candidate and its donor location. */
  maxGapHours: number;
  /** `source_system`s eligible for estimation (physical-presence allowlist). */
  sourceSystems: string[];
}

export interface EstimateBatchResult {
  /** Coordinate-less candidates eligible for this batch (upper bound). */
  candidates: number;
  /** Candidates actually filled (those with a donor location within the gap). */
  estimated: number;
}

/**
 * LifeScope-style temporal location estimation. Fills `location_coordinates` for
 * physical-presence events that have no coordinates of their own by copying the
 * nearest-in-time REAL location — a `ci.position` GPS fix when available, else a
 * located event — within a bounded time gap. Mirrors LifeScope's "coordinates
 * set to the non-estimated location closest in time".
 *
 * Idempotent and re-runnable: estimated rows are excluded as both candidates and
 * donors (`metadata.location_source <> 'estimated'`), so re-runs never chain an
 * estimate off another estimate, and the `location_coordinates IS NULL` filter
 * guarantees measured/geocoded coordinates are never overwritten.
 */
@Injectable()
export class LocationEstimateService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(LocationEstimateService.name);
  }

  /** Coordinate-less physical-presence events eligible for estimation (upper bound). */
  async countCandidates(userId: string, sourceSystems: string[]): Promise<number> {
    const rows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS count
         FROM ci.events e
        WHERE e.user_id = $1
          AND e.location_coordinates IS NULL
          AND e.is_deleted = false
          AND e.source_system = ANY($2)
          AND COALESCE(e.metadata->>'location_source', '') <> 'estimated'`,
      [userId, sourceSystems],
    );

    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Estimate up to `limit` candidates. Returns the eligible candidate count and
   * the number actually filled (a candidate with no donor location within the
   * gap is left untouched). A single set-based UPDATE — no per-row round-trips.
   */
  async estimateBatch(userId: string, opts: EstimateBatchOptions): Promise<EstimateBatchResult> {
    const maxGapSeconds = Math.round(opts.maxGapHours * 3600);
    const candidates = await this.countCandidates(userId, opts.sourceSystems);

    if (candidates === 0) {
      return { candidates: 0, estimated: 0 };
    }

    const updated: Array<{ event_id: string }> = await this.dataSource.query(
      `WITH candidate AS (
         SELECT e.event_id, e.start_time
           FROM ci.events e
          WHERE e.user_id = $1
            AND e.location_coordinates IS NULL
            AND e.is_deleted = false
            AND e.source_system = ANY($2)
            AND COALESCE(e.metadata->>'location_source', '') <> 'estimated'
          ORDER BY e.start_time DESC
          LIMIT $3
       )
       UPDATE ci.events tgt
          SET location_coordinates = d.coords,
              is_inferred = true,
              confidence_score = LEAST(COALESCE(tgt.confidence_score, 1.0), $5),
              metadata = COALESCE(tgt.metadata, '{}'::jsonb)
                         || jsonb_build_object('location_source', 'estimated'),
              inference_sources = jsonb_build_object(
                'method', 'temporal_nn',
                'donor', d.donor,
                'donor_id', d.donor_id,
                'delta_seconds', round(d.delta_seconds)::int,
                'accuracy_meters', d.accuracy_meters,
                'max_gap_hours', $6::numeric
              ),
              updated_at = now()
         FROM candidate c
         CROSS JOIN LATERAL (
           SELECT coords, donor, donor_id, delta_seconds, accuracy_meters
             FROM (
               -- Prefer a high-accuracy GPS breadcrumb (the true "non-estimated
               -- location closest in time"). Each UNION branch is parenthesized so
               -- its ORDER BY/LIMIT binds to that branch, not the whole union.
               (
                 SELECT p.location AS coords, 'position' AS donor, p.id::text AS donor_id,
                        abs(extract(epoch FROM (p.time - c.start_time))) AS delta_seconds,
                        p.accuracy_meters AS accuracy_meters
                   FROM ci.position p
                  WHERE p.user_id = $1
                    AND p.location IS NOT NULL
                    AND abs(extract(epoch FROM (p.time - c.start_time))) <= $4
                  ORDER BY abs(extract(epoch FROM (p.time - c.start_time))) ASC
                  LIMIT 1
               )
               UNION ALL
               -- Fall back to the nearest located event with REAL (non-estimated)
               -- coordinates.
               (
                 SELECT n.location_coordinates AS coords, 'event' AS donor, n.event_id::text AS donor_id,
                        abs(extract(epoch FROM (n.start_time - c.start_time))) AS delta_seconds,
                        NULL::double precision AS accuracy_meters
                   FROM ci.events n
                  WHERE n.user_id = $1
                    AND n.location_coordinates IS NOT NULL
                    AND n.event_id <> c.event_id
                    AND n.is_deleted = false
                    AND COALESCE(n.metadata->>'location_source', '') <> 'estimated'
                    AND abs(extract(epoch FROM (n.start_time - c.start_time))) <= $4
                  ORDER BY abs(extract(epoch FROM (n.start_time - c.start_time))) ASC
                  LIMIT 1
               )
             ) donors
            ORDER BY (donor <> 'position'), delta_seconds ASC
            LIMIT 1
         ) d
        WHERE tgt.event_id = c.event_id
       RETURNING tgt.event_id`,
      [userId, opts.sourceSystems, opts.limit, maxGapSeconds, ESTIMATED_CONFIDENCE, opts.maxGapHours],
    );

    const estimated = Array.isArray(updated) ? updated.length : 0;

    this.logger.log('Temporal location estimation batch complete', {
      userId,
      candidates,
      estimated,
      maxGapHours: opts.maxGapHours,
    });

    return { candidates, estimated };
  }
}
