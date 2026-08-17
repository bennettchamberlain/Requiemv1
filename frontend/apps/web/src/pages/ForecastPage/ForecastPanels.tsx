import { Card } from '@ci/shadcn';

import type { ForecastBucket } from '@/api/useForecastService';

type MetricForecast = {
  metric: string;
  status: string;
  points: Array<{ date: string; q10: number; q50: number; q90: number }>;
};

type HistoryDay = {
  date: string;
  buckets: Array<{
    bucketIndex: number;
    predictedL0: Array<{ label: string; probability: number }>;
  }>;
};

type PlaceItem = {
  lat: number;
  lng: number;
  visits: number;
  share: number;
  label?: string | null;
  probability?: number;
  backoffLevel?: string | null;
};

type Calibration = {
  basis: string;
  latest: {
    l0Top1Acc: number | null;
    ece: number | null;
    driftFlag: boolean;
  } | null;
};

function topLabel(
  entries: Array<{ label: string; probability: number }>,
): { label: string; probability: number } | null {
  const top = [...entries].sort((a, b) => b.probability - a.probability)[0];

  return top ?? null;
}

function baselineProbability(historyDays: HistoryDay[], bucketIndex: number, label: string): number | null {
  const samples = historyDays.flatMap((day) => {
    const bucket = day.buckets.find((item) => item.bucketIndex === bucketIndex);
    if (!bucket) {
      return [];
    }

    return [bucket.predictedL0.find((entry) => entry.label === label)?.probability ?? 0];
  });

  if (samples.length < 2) {
    return null;
  }

  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

export function NextUpPanel({
  buckets,
  historyDays = [],
}: {
  buckets: ForecastBucket[];
  historyDays?: HistoryDay[];
}) {
  const now = Date.now();
  const upcoming = buckets
    .filter((bucket) => new Date(bucket.startTime).getTime() >= now)
    .slice(0, 8)
    .map((bucket) => {
      const top = topLabel(bucket.l0Probs);
      const l1 = topLabel(bucket.l1Probs);
      const baseline = top ? baselineProbability(historyDays, bucket.bucketIndex, top.label) : null;
      const deltaPp = top && baseline != null ? Math.round((top.probability - baseline) * 100) : null;

      return { bucket, top, l1, deltaPp };
    })
    .filter((row) => row.top);

  if (upcoming.length === 0) {
    return null;
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Next up</Card.Title>
        <Card.Description>
          Coming slots vs your usual baseline. Deltas hide until history exists.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
        {upcoming.map(({ bucket, top, l1, deltaPp }) => (
          <div key={bucket.bucketIndex} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="w-16 shrink-0 text-muted-foreground">
              {new Date(bucket.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {top?.label}
              {l1 && l1.probability > 0.1 ? (
                <span className="text-muted-foreground"> · {l1.label.slice(0, 28)}</span>
              ) : null}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round((top?.probability ?? 0) * 100)}%
            </span>
            {deltaPp != null && (
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                {deltaPp > 0 ? '+' : ''}
                {deltaPp} pp
              </span>
            )}
          </div>
        ))}
      </Card.Content>
    </Card>
  );
}

const METRIC_LABELS: Record<string, string> = {
  avg_sentiment: 'Sentiment',
  screen_minutes: 'Screen time',
  n_conversations: 'Conversations',
  km_traveled: 'Distance',
};

export function MetricBandsPanel({ metrics }: { metrics: MetricForecast[] }) {
  const visible = metrics.filter((metric) => metric.status === 'OK' && metric.points.length > 0);
  if (visible.length === 0) {
    return null;
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Metric forecast</Card.Title>
        <Card.Description>Next-day outlook (q10–q90 band, q50 point) from the daily store.</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2 text-sm">
        {visible.map((metric) => {
          const next = metric.points[0];

          return (
            <div key={metric.metric} className="flex items-baseline justify-between">
              <span className="text-muted-foreground">
                {METRIC_LABELS[metric.metric] ?? metric.metric.replace(/_/g, ' ')}
              </span>
              <span className="font-medium">
                {next.q10.toFixed(1)} – {next.q90.toFixed(1)}
                <span className="text-muted-foreground"> (≈ {next.q50.toFixed(1)} next)</span>
              </span>
            </div>
          );
        })}
      </Card.Content>
    </Card>
  );
}

export function NextPlacesPanel({ places }: { places: PlaceItem[] }) {
  if (places.length === 0) {
    return null;
  }

  const backoff = places[0]?.backoffLevel;

  return (
    <Card>
      <Card.Header>
        <Card.Title>Next places</Card.Title>
        <Card.Description>
          Likely next stay from your recent place transitions, given where you are and the time of
          day
          {backoff ? ` (${backoff.replace(/_/g, ' ').toLowerCase()})` : ''}.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2 text-sm">
        {places.map((place) => {
          const probability = place.probability ?? place.share;

          return (
            <div key={`${place.lat},${place.lng}`} className="flex items-baseline justify-between">
              <span className="min-w-0 flex-1 truncate font-medium">
                {place.label?.trim() || `${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}`}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {Math.round(probability * 100)}%
                {place.visits > 0 ? ` · ${place.visits} stays` : ''}
              </span>
            </div>
          );
        })}
      </Card.Content>
    </Card>
  );
}

export function CalibrationPanel({ calibration }: { calibration: Calibration | null }) {
  if (!calibration?.latest) {
    return null;
  }

  const acc = calibration.latest.l0Top1Acc;
  const ece = calibration.latest.ece;

  return (
    <Card>
      <Card.Header>
        <Card.Title>Forecast trust</Card.Title>
        <Card.Description>
          Self-consistency against pipeline labels ({calibration.basis}), not ground-truth accuracy.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-1 text-sm">
        <div>Top-1 match: {acc == null ? '—' : `${Math.round(acc * 100)}%`}</div>
        <div>Calibration error (ECE): {ece == null ? '—' : ece.toFixed(3)}</div>
        {calibration.latest.driftFlag && (
          <div className="text-destructive">Accuracy has drifted below its recent baseline.</div>
        )}
      </Card.Content>
    </Card>
  );
}
