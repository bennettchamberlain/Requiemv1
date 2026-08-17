import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/logging';

import { EventEntity } from '../entities/EventEntity';

import {
  amountToMinorSql,
  CALENDAR_EVENT_TYPES,
  MEDIA_EVENT_TYPES,
  OUTGOING_EVENT_TYPES,
  PLACE_EVENT_TYPES,
  SIGNED_TRANSACTION_TYPE,
  SOCIAL_EVENT_TYPES,
  TIME_BUCKET_LABELS,
  TRAVEL_EVENT_TYPES,
  buildLifeInsights,
  type ChannelRow,
  type ConversationRow,
  type LifeSeries,
  type SocialRow,
  type SpendRow,
  type TimeBucket,
  type TimeRow,
  type TimeSeries,
} from './lifeStats';

export type { LifeSeries } from './lifeStats';

const SPEND_LIMIT = 40;
const CONVERSATION_LIMIT = 12;
const CHANNEL_LIMIT = 8;

const TIMED_EVENT_TYPES = [
  ...CALENDAR_EVENT_TYPES,
  ...MEDIA_EVENT_TYPES,
  ...PLACE_EVENT_TYPES,
  ...TRAVEL_EVENT_TYPES,
] as const;

/** Range bounds for the life series. Null means unbounded on that side. */
export interface LifeStatsRange {
  from: Date | null;
  to: Date | null;
}

/**
 * Server-side aggregates for the stats page life charts. Inventory totals stay
 * on {@link GraphUtilityService} / {@link EventService.getTimelineStats}; this
 * service only builds spend / time / conversation / social series so the
 * browser never pages those tables.
 */
@Injectable()
export class LifeStatsService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepository: Repository<EventEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(LifeStatsService.name);
  }

  async getLifeSeries(userId: string, range: LifeStatsRange): Promise<LifeSeries> {
    const [spendRows, time, conversationRows, social, channelRows] = await Promise.all([
      this.spendByMerchant(userId, range),
      this.timeBreakdown(userId, range),
      this.topConversations(userId, range),
      this.socialOverTime(userId, range),
      this.channels(userId, range),
    ]);

    return {
      spend: { rows: spendRows },
      time,
      conversations: { rows: conversationRows },
      social,
      channels: { rows: channelRows },
      insights: buildLifeInsights({
        spend: spendRows,
        time,
        conversations: conversationRows,
        channels: channelRows,
      }),
    };
  }

  private bounds(range: LifeStatsRange): [Date | null, Date | null] {
    return [range.from, range.to];
  }

  /**
   * Outgoing commerce events (parsed `metadata.Amount`) union receipts with a
   * first-class total, grouped by merchant / counterparty.
   */
  async spendByMerchant(userId: string, range: LifeStatsRange): Promise<SpendRow[]> {
    const rows: Array<{
      merchant: string;
      n: string;
      total_minor: string;
      avg_minor: string;
      currency: string | null;
      sources: string[] | null;
    }> = await this.eventRepository.manager.query(
      `SELECT merchant,
              COUNT(*)::text AS n,
              SUM(amount_minor)::text AS total_minor,
              ROUND(AVG(amount_minor))::text AS avg_minor,
              COALESCE(MAX(currency), 'USD') AS currency,
              ARRAY_AGG(DISTINCT source_system) AS sources
         FROM (
           SELECT COALESCE(
                    NULLIF(e.metadata->>'To', ''),
                    NULLIF(e.metadata->>'Merchant', ''),
                    NULLIF(e.metadata->>'From', ''),
                    NULLIF(b.name, ''),
                    'Unknown merchant'
                  ) AS merchant,
                  ABS(${amountToMinorSql('e.metadata')}) AS amount_minor,
                  COALESCE(e.source_system, 'unknown') AS source_system,
                  'USD' AS currency
             FROM ci.events e
             LEFT JOIN ci.entities b ON b.entity_id = e.event_id
            WHERE e.user_id = $1
              AND e.is_deleted = false
              AND ($2::timestamptz IS NULL OR e.start_time >= $2)
              AND ($3::timestamptz IS NULL OR e.start_time < $3)
              AND ${amountToMinorSql('e.metadata')} IS NOT NULL
              AND ${amountToMinorSql('e.metadata')} <> 0
              AND (
                    e.event_type = ANY($4::text[])
                    OR (
                      e.event_type = $5
                      AND ${amountToMinorSql('e.metadata')} < 0
                    )
                  )
           UNION ALL
           SELECT COALESCE(NULLIF(r.merchant_name, ''), 'Unknown merchant') AS merchant,
                  r.total_minor AS amount_minor,
                  COALESCE(r.source_system, 'unknown') AS source_system,
                  COALESCE(r.currency, 'USD') AS currency
             FROM ci.receipts r
            WHERE r.user_id = $1
              AND r.total_minor IS NOT NULL
              AND r.total_minor > 0
              AND ($2::timestamptz IS NULL OR r.purchased_at >= $2)
              AND ($3::timestamptz IS NULL OR r.purchased_at < $3)
         ) spend
        GROUP BY merchant
        ORDER BY SUM(amount_minor) DESC
        LIMIT $6`,
      [userId, ...this.bounds(range), [...OUTGOING_EVENT_TYPES], SIGNED_TRANSACTION_TYPE, SPEND_LIMIT],
    );

    return rows.map((row) => ({
      merchant: row.merchant,
      count: Number(row.n),
      totalMinor: Number(row.total_minor),
      avgMinor: Number(row.avg_minor),
      currency: row.currency ?? 'USD',
      sources: (row.sources ?? []).filter(Boolean),
    }));
  }

  async timeBreakdown(userId: string, range: LifeStatsRange): Promise<TimeSeries> {
    const eventRows: Array<{
      bucket: TimeBucket;
      event_count: string;
      timed_count: string;
      minutes: string;
    }> = await this.eventRepository.manager.query(
      `SELECT CASE
                  WHEN e.event_type = ANY($4::text[]) THEN 'calendar'
                  WHEN e.event_type = ANY($5::text[]) THEN 'media'
                  WHEN e.event_type = ANY($6::text[]) THEN 'places'
                  WHEN e.event_type = ANY($7::text[]) THEN 'travel'
                  ELSE 'other'
                END AS bucket,
                COUNT(*)::text AS event_count,
                COUNT(e.duration_minutes)::text AS timed_count,
                COALESCE(SUM(e.duration_minutes), 0)::text AS minutes
           FROM ci.events e
          WHERE e.user_id = $1
            AND e.is_deleted = false
            AND ($2::timestamptz IS NULL OR e.start_time >= $2)
            AND ($3::timestamptz IS NULL OR e.start_time < $3)
            AND (
                  e.event_type = ANY($8::text[])
                  OR e.duration_minutes IS NOT NULL
                )
          GROUP BY 1`,
      [
        userId,
        ...this.bounds(range),
        [...CALENDAR_EVENT_TYPES],
        [...MEDIA_EVENT_TYPES],
        [...PLACE_EVENT_TYPES],
        [...TRAVEL_EVENT_TYPES],
        [...TIMED_EVENT_TYPES],
      ],
    );

    const callRows: Array<{ seconds: string; n: string }> = await this.eventRepository.manager.query(
      `SELECT COALESCE(SUM(c.duration_seconds), 0)::text AS seconds,
              COUNT(*)::text AS n
         FROM ci.communications c
        WHERE c.user_id = $1
          AND c.duration_seconds IS NOT NULL
          AND c.duration_seconds > 0
          AND ($2::timestamptz IS NULL OR c.time >= $2)
          AND ($3::timestamptz IS NULL OR c.time < $3)`,
      [userId, ...this.bounds(range)],
    );

    const rows: TimeRow[] = eventRows.map((row) => ({
      bucket: row.bucket,
      label: TIME_BUCKET_LABELS[row.bucket],
      minutes: Number(row.minutes),
      count: Number(row.event_count),
    }));

    const callSeconds = Number(callRows[0]?.seconds ?? 0);
    const callCount = Number(callRows[0]?.n ?? 0);
    if (callCount > 0) {
      rows.push({
        bucket: 'calls',
        label: TIME_BUCKET_LABELS.calls,
        minutes: Math.round(callSeconds / 60),
        count: callCount,
      });
    }

    const consideredEvents = rows.reduce((sum, row) => sum + row.count, 0);
    const timedEvents =
      eventRows.reduce((sum, row) => sum + Number(row.timed_count), 0) + (callCount > 0 ? callCount : 0);
    const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
    const ordered = rows.sort((a, b) => (totalMinutes > 0 ? b.minutes - a.minutes : b.count - a.count));

    return {
      mode: totalMinutes > 0 ? 'hours' : 'counts',
      coverage: { timedEvents, consideredEvents },
      rows: ordered,
    };
  }

  async topConversations(userId: string, range: LifeStatsRange): Promise<ConversationRow[]> {
    const rows: Array<{
      pid: string;
      name: string | null;
      n: string;
      inbound: string;
      outbound: string;
      last_at: Date | null;
    }> = await this.eventRepository.manager.query(
      `SELECT m.pid,
              e.name,
              COUNT(DISTINCT m.id)::text AS n,
              COUNT(DISTINCT m.id) FILTER (WHERE m.direction = 'inbound')::text AS inbound,
              COUNT(DISTINCT m.id) FILTER (WHERE m.direction = 'outbound')::text AS outbound,
              MAX(m.time) AS last_at
         FROM (
           SELECT c.from_entity_id AS pid, c.id, c.time, c.direction
             FROM ci.communications c
            WHERE c.user_id = $1
              AND c.from_entity_id IS NOT NULL
              AND ($2::timestamptz IS NULL OR c.time >= $2)
              AND ($3::timestamptz IS NULL OR c.time < $3)
           UNION ALL
           SELECT p.pid, c.id, c.time, c.direction
             FROM ci.communications c
             CROSS JOIN LATERAL unnest(c.to_entity_ids) AS p(pid)
            WHERE c.user_id = $1
              AND c.to_entity_ids IS NOT NULL
              AND ($2::timestamptz IS NULL OR c.time >= $2)
              AND ($3::timestamptz IS NULL OR c.time < $3)
         ) m
         JOIN ci.entities e ON e.entity_id = m.pid
        WHERE e.entity_type = 'Person'
          AND COALESCE(e.is_self, false) = false
          AND e.merged_into_entity_id IS NULL
        GROUP BY m.pid, e.name
        ORDER BY COUNT(DISTINCT m.id) DESC
        LIMIT $4`,
      [userId, ...this.bounds(range), CONVERSATION_LIMIT],
    );

    return rows.map((row) => ({
      personId: row.pid,
      name: row.name?.trim() || 'Unknown person',
      count: Number(row.n),
      inbound: Number(row.inbound),
      outbound: Number(row.outbound),
      lastAt: row.last_at ? new Date(row.last_at).toISOString() : null,
    }));
  }

  async socialOverTime(
    userId: string,
    range: LifeStatsRange,
  ): Promise<{ granularity: 'week' | 'month'; rows: SocialRow[] }> {
    const granularity = socialGranularity(range);
    const rows: Array<{ bucket: Date; source_system: string; kind: string; n: string }> =
      await this.eventRepository.manager.query(
        `SELECT date_trunc($4, e.start_time) AS bucket,
                COALESCE(NULLIF(e.source_system, ''), 'unknown') AS source_system,
                e.event_type AS kind,
                COUNT(*)::text AS n
           FROM ci.events e
          WHERE e.user_id = $1
            AND e.is_deleted = false
            AND e.event_type = ANY($5::text[])
            AND ($2::timestamptz IS NULL OR e.start_time >= $2)
            AND ($3::timestamptz IS NULL OR e.start_time < $3)
          GROUP BY 1, 2, 3
          ORDER BY 1`,
        [userId, ...this.bounds(range), granularity, [...SOCIAL_EVENT_TYPES]],
      );

    return {
      granularity,
      rows: rows.map((row) => ({
        bucket: new Date(row.bucket).toISOString(),
        sourceSystem: row.source_system,
        kind: row.kind,
        count: Number(row.n),
      })),
    };
  }

  async channels(userId: string, range: LifeStatsRange): Promise<ChannelRow[]> {
    const rows: Array<{ source: string; n: string }> = await this.eventRepository.manager.query(
      `SELECT COALESCE(NULLIF(c.source_system, ''), c.communication_type, 'unknown') AS source,
              COUNT(*)::text AS n
         FROM ci.communications c
        WHERE c.user_id = $1
          AND ($2::timestamptz IS NULL OR c.time >= $2)
          AND ($3::timestamptz IS NULL OR c.time < $3)
        GROUP BY 1
        ORDER BY COUNT(*) DESC
        LIMIT $4`,
      [userId, ...this.bounds(range), CHANNEL_LIMIT],
    );

    return rows.map((row) => ({
      source: row.source,
      count: Number(row.n),
    }));
  }
}

function socialGranularity(range: LifeStatsRange): 'week' | 'month' {
  if (range.from == null || range.to == null) {
    return 'month';
  }

  const spanMs = range.to.getTime() - range.from.getTime();
  const day = 24 * 60 * 60 * 1000;

  return spanMs > 180 * day ? 'month' : 'week';
}
