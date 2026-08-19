export interface ForecastBucket {
  bucket_index: number;
  start_time: string;
  l0_probs: Record<string, number>;
  l1_probs: Record<string, number>;
  l2_probs: Record<string, number> | null;
  q10: number;
  q50: number;
  q90: number;
}

export interface ForecastResponse {
  horizon: string;
  generated_at: string;
  system_status: string;
  model_version?: string;
  still_learning?: boolean;
  buckets: ForecastBucket[];
}

export interface WeekForecastCluster {
  cluster_id: string;
  name: string;
  l0_class: string;
  p_occur: number;
  daypart_probs: Record<string, number>;
  /** True when a confirmed/tentative calendar event pins this cell (Layer 2). */
  scheduled?: boolean;
}

export interface WeekForecastDay {
  date: string;
  dow: string;
  clusters: WeekForecastCluster[];
}

export interface WeekForecastResponse {
  horizon: string;
  generated_at: string;
  days: WeekForecastDay[];
}

export interface DueItem {
  cluster_id: string;
  name: string;
  l0_class: string;
  last_seen: string;
  days_since_last: number;
  median_interval_days: number;
  due_in_days: number;
  window: [number, number];
  overdue: boolean;
  /** ISO date of the next matching booked event, or null (Layer 1 reconciliation). */
  scheduled_date: string | null;
  confidence: number;
}

export interface DueResponse {
  generated_at: string;
  due: DueItem[];
}
