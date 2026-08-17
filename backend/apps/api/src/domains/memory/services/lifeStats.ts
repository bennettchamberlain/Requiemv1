/**
 * Pure helpers for the stats-page life series. SQL in {@link LifeStatsService}
 * must stay aligned with {@link parseAmountToMinor} and the outgoing / time /
 * social allowlists — the service tests pin both sides.
 */

/** Commerce event_type values that are outgoing spend (use abs(amount)). */
export const OUTGOING_EVENT_TYPES = ['payment', 'purchase', 'order', 'withdrawal', 'sale'] as const;

/** Unsigned `transaction` rows are only spend when the parsed amount is negative. */
export const SIGNED_TRANSACTION_TYPE = 'transaction';

export const SOCIAL_EVENT_TYPES = ['like', 'post', 'comment'] as const;

export const CALENDAR_EVENT_TYPES = ['event', 'calendar_event', 'meeting', 'appointment'] as const;
export const MEDIA_EVENT_TYPES = ['play', 'watch', 'listen', 'read'] as const;
export const PLACE_EVENT_TYPES = ['place'] as const;
export const TRAVEL_EVENT_TYPES = ['trip'] as const;

export type TimeBucket = 'calendar' | 'media' | 'places' | 'travel' | 'calls' | 'other';

export const TIME_BUCKET_LABELS: Readonly<Record<TimeBucket, string>> = {
  calendar: 'Calendar',
  media: 'Media',
  places: 'Places',
  travel: 'Travel',
  calls: 'Calls',
  other: 'Other',
};

/** Show hours only when at least this share of considered events have a duration. */
export const TIME_HOURS_COVERAGE = 0.25;

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  imessage: 'iMessage',
  whatsapp: 'WhatsApp',
  gmail: 'Gmail',
  email: 'Email',
  sms: 'SMS',
  signal: 'Signal',
  twitter: 'Twitter',
  instagram: 'Instagram',
  telegram: 'Telegram',
};

export function labelChannel(source: string): string {
  return CHANNEL_LABELS[source.toLowerCase()] ?? source;
}

export function resolveTimeMode(timedEvents: number, consideredEvents: number, totalMinutes: number): 'hours' | 'counts' {
  const coverage = consideredEvents > 0 ? timedEvents / consideredEvents : 0;

  return totalMinutes > 0 && coverage >= TIME_HOURS_COVERAGE ? 'hours' : 'counts';
}

/**
 * Postgres expression that turns `column->>'Amount'` (`-$12.00`, `+$74.00`,
 * `$1,299.00`) into integer minor units. Same cleanup as {@link parseAmountToMinor}.
 */
export function amountToMinorSql(column: string): string {
  return `CASE
  WHEN NULLIF(regexp_replace(${column}->>'Amount', '[^0-9.+-]', '', 'g'), '') IS NULL THEN NULL
  ELSE ROUND(regexp_replace(${column}->>'Amount', '[^0-9.+-]', '', 'g')::numeric * 100)::bigint
END`;
}

/**
 * Parse a commerce amount string into integer minor units (cents for USD).
 * Returns null when there is no finite number.
 */
export function parseAmountToMinor(raw: string | null | undefined): number | null {
  if (raw == null) {
    return null;
  }

  const cleaned = raw.replace(/[^0-9.+-]/g, '');
  if (
    !cleaned ||
    cleaned === '+' ||
    cleaned === '-' ||
    cleaned === '.' ||
    cleaned === '+.' ||
    cleaned === '-.'
  ) {
    return null;
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100);
}

/** True when this event_type + signed amount is outgoing spend. */
export function isOutgoingSpend(eventType: string | null | undefined, amountMinor: number | null): boolean {
  if (amountMinor == null || amountMinor === 0) {
    return false;
  }

  if (eventType != null && (OUTGOING_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return true;
  }

  return eventType === SIGNED_TRANSACTION_TYPE && amountMinor < 0;
}

export function timeBucketForEventType(eventType: string | null | undefined): TimeBucket | null {
  if (eventType == null) {
    return null;
  }

  if ((CALENDAR_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return 'calendar';
  }

  if ((MEDIA_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return 'media';
  }

  if ((PLACE_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return 'places';
  }

  if ((TRAVEL_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return 'travel';
  }

  return null;
}

export function parseStatsBound(value: string | undefined): Date | null {
  if (!value?.trim()) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface SpendRow {
  merchant: string;
  count: number;
  totalMinor: number;
  avgMinor: number;
  currency: string;
  sources: string[];
}

export interface TimeRow {
  bucket: TimeBucket;
  label: string;
  minutes: number;
  count: number;
}

export interface ConversationRow {
  personId: string;
  name: string;
  count: number;
  inbound: number;
  outbound: number;
  lastAt: string | null;
}

export interface SocialRow {
  bucket: string;
  sourceSystem: string;
  kind: string;
  count: number;
}

export interface ChannelRow {
  source: string;
  count: number;
}

export interface LifeInsight {
  id: string;
  title: string;
  body: string;
  href?: string;
}

export interface TimeSeries {
  mode: 'hours' | 'counts';
  coverage: { timedEvents: number; consideredEvents: number };
  rows: TimeRow[];
}

export interface LifeSeries {
  spend: { rows: SpendRow[] };
  time: TimeSeries;
  conversations: { rows: ConversationRow[] };
  social: { granularity: 'week' | 'month'; rows: SocialRow[] };
  channels: { rows: ChannelRow[] };
  insights: LifeInsight[];
}

function formatMinorUsd(minor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (hours >= 10) {
    return `${Math.round(hours)}h`;
  }

  const rounded = Math.round(hours * 10) / 10;

  return `${rounded}h`;
}

/**
 * Deterministic insight cards from the same aggregates the charts use.
 * Omit a card when its series is empty — never invent a number.
 */
export function buildLifeInsights(series: {
  spend: SpendRow[];
  time: TimeSeries;
  conversations: ConversationRow[];
  channels: ChannelRow[];
}): LifeInsight[] {
  const insights: LifeInsight[] = [];
  const topPerson = series.conversations[0];
  if (topPerson) {
    insights.push({
      id: 'top-person',
      title: 'Most messaged',
      body: `${topPerson.name} (${topPerson.count.toLocaleString()} messages)`,
      href: `/people/${topPerson.personId}`,
    });
  }

  const topMerchant = series.spend[0];
  if (topMerchant) {
    insights.push({
      id: 'top-spend',
      title: 'Largest outgoing merchant',
      body: `${topMerchant.merchant} (${formatMinorUsd(topMerchant.totalMinor)} across ${topMerchant.count.toLocaleString()} payments)`,
    });
  }

  const topTime = [...series.time.rows].sort((a, b) =>
    series.time.mode === 'hours' ? b.minutes - a.minutes : b.count - a.count,
  )[0];
  if (topTime) {
    insights.push({
      id: 'top-time',
      title: series.time.mode === 'hours' ? 'Most hours' : 'Most events',
      body:
        series.time.mode === 'hours'
          ? `${topTime.label} (${formatHours(topTime.minutes)})`
          : `${topTime.label} (${topTime.count.toLocaleString()} events)`,
    });
  }

  const topChannel = series.channels[0];
  if (topChannel) {
    insights.push({
      id: 'top-channel',
      title: 'Busiest channel',
      body: `${labelChannel(topChannel.source)} (${topChannel.count.toLocaleString()} messages)`,
    });
  }

  return insights;
}
