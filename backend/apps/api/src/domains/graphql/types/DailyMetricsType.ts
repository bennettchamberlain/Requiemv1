import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { DailyMetrics } from '@ci/domains/daily-metrics';

@ObjectType({ description: 'One local-day row from the daily feature store' })
export class DailyMetricsType {
  @Field(() => String)
  date!: string;

  @Field(() => String)
  timezone!: string;

  @Field(() => Int, { nullable: true })
  nMessages!: number | null;

  @Field(() => Int, { nullable: true })
  nConversations!: number | null;

  @Field(() => Int, { nullable: true })
  nUniqueContacts!: number | null;

  @Field(() => Float, { nullable: true })
  outboundRatio!: number | null;

  @Field(() => Float, { nullable: true })
  avgSentiment!: number | null;

  @Field(() => Int, { nullable: true })
  nPlaces!: number | null;

  @Field(() => Float, { nullable: true })
  kmTraveled!: number | null;

  @Field(() => Float, { nullable: true })
  screenMinutes!: number | null;

  @Field(() => Int, { nullable: true })
  nDomains!: number | null;

  @Field(() => Float, { nullable: true })
  spendTotal!: number | null;

  @Field(() => Float, { nullable: true })
  meetingMinutes!: number | null;

  @Field(() => Float, { nullable: true })
  sleepMinutes!: number | null;

  @Field(() => Float, { nullable: true })
  timeAtHome!: number | null;

  @Field(() => String, { description: 'ISO-8601 when this row was last computed' })
  computedAt!: string;

  static toType(source: DailyMetrics): DailyMetricsType {
    return {
      date: source.date,
      timezone: source.timezone,
      nMessages: source.metrics.n_messages,
      nConversations: source.metrics.n_conversations,
      nUniqueContacts: source.metrics.n_unique_contacts,
      outboundRatio: source.metrics.outbound_ratio,
      avgSentiment: source.metrics.avg_sentiment,
      nPlaces: source.metrics.n_places,
      kmTraveled: source.metrics.km_traveled,
      screenMinutes: source.metrics.screen_minutes,
      nDomains: source.metrics.n_domains,
      spendTotal: source.metrics.spend_total,
      meetingMinutes: source.metrics.meeting_minutes,
      sleepMinutes: source.metrics.sleep_minutes,
      timeAtHome: source.metrics.time_at_home,
      computedAt: source.computedAt.toISOString(),
    };
  }
}
