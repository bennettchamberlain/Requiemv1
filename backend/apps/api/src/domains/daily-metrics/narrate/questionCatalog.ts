import type { MetricKey } from '../types';

/** The ten life domains the insight engine organizes questions under. */
export type Category =
  | 'Body'
  | 'Time'
  | 'Relationships'
  | 'Mind'
  | 'Places'
  | 'Money'
  | 'Attention'
  | 'Home'
  | 'Identity'
  | 'Commitments';

/** How a metric's daily series is collapsed over the timeframe. */
export type Aggregate = 'latest' | 'sum' | 'avg' | 'max' | 'active_days';

export interface Timeframe {
  /** Number of calendar days ending on the anchor date (1 = the anchor day). */
  days: number;
  /** Human phrase used in narration, e.g. "today", "the last 7 days". */
  label: string;
}

export type AnalyticType = 'descriptive' | 'predictive' | 'correlational' | 'anomaly' | 'optimization';

export type ValueFormat = 'int' | 'float1' | 'float2' | 'money' | 'signed2';

/**
 * A declarative question: a compute plan plus a narration template.
 * `analyticType` defaults to descriptive so the original 18 specs stay valid.
 */
export interface QuestionSpec {
  key: string;
  category: Category;
  question: string;
  metric: MetricKey;
  aggregate: Aggregate;
  timeframe: Timeframe;
  /**
   * Narration template. Available placeholders: {value}, {unit}, {timeframe},
   * {days}, {daysWithData}, {coveragePct}, plus {effect}, {lag}, {q}, {baseline}
   * for non-descriptive types.
   */
  template: string;
  unit?: string;
  format: ValueFormat;
  /** Optional multiplier applied to the aggregated value before formatting
   *  (e.g. 100 for a ratio→percent, 1/60 for minutes→hours). */
  scale?: number;
  analyticType?: AnalyticType;
  pairMetric?: MetricKey;
  lagDays?: number;
  suggestionKey?: string;
}

export const TODAY: Timeframe = { days: 1, label: 'today' };
export const WEEK: Timeframe = { days: 7, label: 'the last 7 days' };
export const MONTH: Timeframe = { days: 30, label: 'the last 30 days' };

/**
 * The descriptive question catalog (prototype slice). ~18 questions spanning
 * several of the ten life domains, each mapping to a metric that is actually
 * materialized in ci_derived.daily_metrics.
 */
export const QUESTION_CATALOG: readonly QuestionSpec[] = [
  // ── Relationships ────────────────────────────────────────────────
  {
    key: 'rel.conversations_today',
    category: 'Relationships',
    question: 'How many conversations did I have today?',
    metric: 'n_conversations',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'int',
    template: 'You had {value} conversations {timeframe}.',
  },
  {
    key: 'rel.unique_contacts_week',
    category: 'Relationships',
    question: 'How many different people am I talking to lately?',
    metric: 'n_unique_contacts',
    aggregate: 'avg',
    timeframe: WEEK,
    format: 'float1',
    template: 'You talked with about {value} different people per day over {timeframe}.',
  },
  {
    key: 'rel.busiest_day_week',
    category: 'Relationships',
    question: 'What was my most social day this week?',
    metric: 'n_conversations',
    aggregate: 'max',
    timeframe: WEEK,
    format: 'int',
    template: 'Your most social day in {timeframe} had {value} conversations.',
  },
  {
    key: 'rel.messages_week',
    category: 'Relationships',
    question: 'How many messages did I exchange this week?',
    metric: 'n_messages',
    aggregate: 'sum',
    timeframe: WEEK,
    format: 'int',
    template: 'You exchanged {value} messages over {timeframe}.',
  },

  // ── Identity ─────────────────────────────────────────────────────
  {
    key: 'identity.initiation_month',
    category: 'Identity',
    question: 'Do I start conversations or mostly respond?',
    metric: 'outbound_ratio',
    aggregate: 'avg',
    timeframe: MONTH,
    format: 'float1',
    scale: 100,
    unit: '%',
    template: 'You initiate about {value}% of your conversations over {timeframe}.',
  },

  // ── Mind ─────────────────────────────────────────────────────────
  {
    key: 'mind.sentiment_today',
    category: 'Mind',
    question: 'What was the tone of my conversations today?',
    metric: 'avg_sentiment',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'signed2',
    template: 'Your conversations {timeframe} had an average sentiment of {value} (-1 to +1).',
  },
  {
    key: 'mind.sentiment_week',
    category: 'Mind',
    question: 'How positive have my conversations been this week?',
    metric: 'avg_sentiment',
    aggregate: 'avg',
    timeframe: WEEK,
    format: 'signed2',
    template: 'Your average conversation sentiment over {timeframe} was {value} (-1 to +1).',
  },

  // ── Places ───────────────────────────────────────────────────────
  {
    key: 'places.today',
    category: 'Places',
    question: 'How many places did I visit today?',
    metric: 'n_places',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'int',
    template: 'You visited {value} distinct places {timeframe}.',
  },
  {
    key: 'places.avg_week',
    category: 'Places',
    question: 'How much do I move around on a typical day?',
    metric: 'n_places',
    aggregate: 'avg',
    timeframe: WEEK,
    format: 'float1',
    template: 'You visited about {value} distinct places per day over {timeframe}.',
  },

  // ── Body / movement ──────────────────────────────────────────────
  {
    key: 'body.km_today',
    category: 'Body',
    question: 'How far did I travel today?',
    metric: 'km_traveled',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'float1',
    unit: 'km',
    template: 'You traveled about {value} km {timeframe}.',
  },
  {
    key: 'body.km_week',
    category: 'Body',
    question: 'How far have I traveled this week?',
    metric: 'km_traveled',
    aggregate: 'sum',
    timeframe: WEEK,
    format: 'float1',
    unit: 'km',
    template: 'You traveled about {value} km over {timeframe}.',
  },
  {
    key: 'body.active_days_week',
    category: 'Body',
    question: 'How many days was I on the move this week?',
    metric: 'km_traveled',
    aggregate: 'active_days',
    timeframe: WEEK,
    format: 'int',
    template: 'You were on the move on {value} of the last {days} days.',
  },
  {
    key: 'body.sleep_week',
    category: 'Body',
    question: 'How much did I sleep this week?',
    metric: 'sleep_minutes',
    aggregate: 'sum',
    timeframe: WEEK,
    format: 'float1',
    unit: 'min',
    template: 'You slept about {value} minutes over {timeframe}.',
  },

  // ── Attention ────────────────────────────────────────────────────
  {
    key: 'attention.screen_today',
    category: 'Attention',
    question: 'How much time did I spend on the web today?',
    metric: 'screen_minutes',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'float1',
    unit: 'min',
    template: 'You spent about {value} minutes on the web {timeframe}.',
  },
  {
    key: 'attention.screen_avg_week',
    category: 'Attention',
    question: 'What is my typical daily web time this week?',
    metric: 'screen_minutes',
    aggregate: 'avg',
    timeframe: WEEK,
    format: 'float1',
    unit: 'min',
    template: 'You averaged about {value} minutes of web time per day over {timeframe}.',
  },
  {
    key: 'attention.domains_today',
    category: 'Attention',
    question: 'How many different sites did I visit today?',
    metric: 'n_domains',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'int',
    template: 'You visited {value} different websites {timeframe}.',
  },

  // ── Time ─────────────────────────────────────────────────────────
  {
    key: 'time.screen_month_hours',
    category: 'Time',
    question: 'How many hours did I spend online this month?',
    metric: 'screen_minutes',
    aggregate: 'sum',
    timeframe: MONTH,
    format: 'float1',
    scale: 1 / 60,
    unit: 'hours',
    template: 'Over {timeframe} you spent about {value} hours on the web.',
  },
  {
    key: 'time.meetings_week',
    category: 'Time',
    question: 'How much time did I spend in meetings this week?',
    metric: 'meeting_minutes',
    aggregate: 'sum',
    timeframe: WEEK,
    format: 'float1',
    unit: 'min',
    template: 'You spent about {value} minutes in meetings over {timeframe}.',
  },

  // ── Home ─────────────────────────────────────────────────────────
  {
    key: 'home.time_week',
    category: 'Home',
    question: 'How much time did I spend at home this week?',
    metric: 'time_at_home',
    aggregate: 'sum',
    timeframe: WEEK,
    format: 'float1',
    unit: 'min',
    template: 'You spent about {value} minutes at home over {timeframe}.',
  },
  {
    key: 'home.time_month',
    category: 'Home',
    question: 'How much time did I spend at home this month?',
    metric: 'time_at_home',
    aggregate: 'sum',
    timeframe: MONTH,
    format: 'float1',
    unit: 'min',
    template: 'You spent about {value} minutes at home over {timeframe}.',
  },

  // ── Money ────────────────────────────────────────────────────────
  {
    key: 'money.spend_today',
    category: 'Money',
    question: 'How much did I spend on things today?',
    metric: 'spend_total',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'money',
    unit: '$',
    template: 'You acquired items worth ${value} {timeframe}.',
  },
  {
    key: 'money.spend_month',
    category: 'Money',
    question: 'How much have I spent on things this month?',
    metric: 'spend_total',
    aggregate: 'sum',
    timeframe: MONTH,
    format: 'money',
    unit: '$',
    template: 'You acquired items worth ${value} over {timeframe}.',
  },

  // ── Correlational ────────────────────────────────────────────────
  {
    key: 'corr.conversations_sentiment_90',
    category: 'Relationships',
    analyticType: 'correlational',
    question: 'Are my conversations associated with conversation tone this quarter?',
    metric: 'n_conversations',
    pairMetric: 'avg_sentiment',
    lagDays: 0,
    aggregate: 'avg',
    timeframe: { days: 90, label: 'the last 90 days' },
    format: 'signed2',
    template:
      'Conversations and conversation tone have been associated (r={effect}) over {timeframe} (q={q}, {daysWithData} overlapping days). This is a hypothesis, not a cause.',
  },
  {
    key: 'corr.conversations_sentiment_lag1',
    category: 'Relationships',
    analyticType: 'correlational',
    question: 'Does conversation volume tend to precede tone the next day?',
    metric: 'n_conversations',
    pairMetric: 'avg_sentiment',
    lagDays: 1,
    aggregate: 'avg',
    timeframe: { days: 90, label: 'the last 90 days' },
    format: 'signed2',
    template:
      'Conversation volume has tended to precede next-day tone (r={effect}, lag {lag} day) over {timeframe} (q={q}). Associated with, not caused by.',
  },
  {
    key: 'corr.screen_sentiment_90',
    category: 'Attention',
    analyticType: 'correlational',
    question: 'Is web time associated with conversation tone?',
    metric: 'screen_minutes',
    pairMetric: 'avg_sentiment',
    lagDays: 0,
    aggregate: 'avg',
    timeframe: { days: 90, label: 'the last 90 days' },
    format: 'signed2',
    template:
      'Web time and conversation tone have been associated (r={effect}) over {timeframe} (q={q}, {daysWithData} overlapping days). This is a hypothesis, not a cause.',
  },
  {
    key: 'corr.km_sentiment_90',
    category: 'Body',
    analyticType: 'correlational',
    question: 'Is distance traveled associated with conversation tone?',
    metric: 'km_traveled',
    pairMetric: 'avg_sentiment',
    lagDays: 0,
    aggregate: 'avg',
    timeframe: { days: 90, label: 'the last 90 days' },
    format: 'signed2',
    template:
      'Distance traveled and conversation tone have been associated (r={effect}) over {timeframe} (q={q}, {daysWithData} overlapping days). This is a hypothesis, not a cause.',
  },

  // ── Anomaly ──────────────────────────────────────────────────────
  {
    key: 'anom.conversations_yesterday',
    category: 'Relationships',
    analyticType: 'anomaly',
    question: 'Was yesterday unusual for conversations?',
    metric: 'n_conversations',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'int',
    template: 'Yesterday had {value} conversations vs a typical {baseline}.',
  },
  {
    key: 'anom.places_yesterday',
    category: 'Places',
    analyticType: 'anomaly',
    question: 'Was yesterday unusual for how many places I visited?',
    metric: 'n_places',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'int',
    template: 'Yesterday you visited {value} places vs a typical {baseline}.',
  },
  {
    key: 'anom.sentiment_yesterday',
    category: 'Mind',
    analyticType: 'anomaly',
    question: 'Was yesterday unusual for conversation tone?',
    metric: 'avg_sentiment',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'signed2',
    template: 'Yesterday conversation tone was {value} vs a typical {baseline}.',
  },
  {
    key: 'anom.screen_yesterday',
    category: 'Attention',
    analyticType: 'anomaly',
    question: 'Was yesterday unusual for web time?',
    metric: 'screen_minutes',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'float1',
    unit: 'min',
    template: 'Yesterday web time was {value} minutes vs a typical {baseline}.',
  },

  // ── Optimization ─────────────────────────────────────────────────
  {
    key: 'opt.conversations_low',
    category: 'Relationships',
    analyticType: 'optimization',
    suggestionKey: 'rel.conversations_low',
    question: 'Was yesterday a quiet conversation day relative to my baseline?',
    metric: 'n_conversations',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'int',
    template: '{value} conversations yesterday vs about {baseline} most days.',
  },
  {
    key: 'opt.screen_spike',
    category: 'Attention',
    analyticType: 'optimization',
    suggestionKey: 'attention.screen_spike',
    question: 'Was yesterday a high web-time day relative to my baseline?',
    metric: 'screen_minutes',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'float1',
    unit: 'min',
    template: 'About {value} minutes on the web yesterday vs about {baseline} most days.',
  },

  // ── Predictive (wraps MetricForecastService) ──────────────────────
  {
    key: 'pred.conversations',
    category: 'Relationships',
    analyticType: 'predictive',
    question: 'How many conversations are typical over the next few days?',
    metric: 'n_conversations',
    aggregate: 'avg',
    timeframe: { days: 3, label: 'the next 3 days' },
    format: 'float1',
    template: 'A typical next few days looks like about {value} conversations per day.',
  },
  {
    key: 'pred.screen',
    category: 'Attention',
    analyticType: 'predictive',
    question: 'What does typical daily web time look like over the next few days?',
    metric: 'screen_minutes',
    aggregate: 'avg',
    timeframe: { days: 3, label: 'the next 3 days' },
    format: 'float1',
    unit: 'min',
    template: 'A typical next few days looks like about {value} minutes of web time per day.',
  },
];
