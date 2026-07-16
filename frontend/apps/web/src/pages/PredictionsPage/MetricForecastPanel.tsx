import { Card, Skeleton } from '@ci/shadcn';
import { Area, ComposedChart, Line, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

import { useMetricForecast } from './api';

interface MetricSpec {
  metric: string;
  label: string;
  unit: string;
  chartVar: string;
}

export const METRIC_SPECS: MetricSpec[] = [
  { metric: 'avg_sentiment', label: 'Avg sentiment', unit: '', chartVar: 'var(--chart-1)' },
  { metric: 'screen_minutes', label: 'Screen time', unit: 'min', chartVar: 'var(--chart-2)' },
  { metric: 'n_conversations', label: 'Conversations', unit: '', chartVar: 'var(--chart-3)' },
  { metric: 'km_traveled', label: 'Distance', unit: 'km', chartVar: 'var(--chart-4)' },
];

function formatValue(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 100) / 100;

  return unit ? `${rounded} ${unit}` : String(rounded);
}

function MetricStrip({ spec }: { spec: MetricSpec }) {
  const { forecast, loading, error } = useMetricForecast(spec.metric);

  const points = forecast?.points ?? [];
  const usable = forecast?.status === 'OK' && points.length > 0;
  const data = points.map((point) => ({
    date: point.date,
    band: [point.q10, point.q90] as [number, number],
    q50: point.q50,
  }));

  const chartConfig = {
    q50: { label: spec.label, color: spec.chartVar },
    band: { label: 'q10–q90', color: spec.chartVar },
  } satisfies ChartConfig;

  return (
    <div className="flex items-center gap-4 py-1">
      <div className="w-32 shrink-0">
        <p className="text-sm font-medium">{spec.label}</p>
        {usable && (
          <p className="text-xs text-muted-foreground tabular-nums">
            ≈ {formatValue(points[0].q50, spec.unit)} next
          </p>
        )}
      </div>

      {loading && !forecast ? (
        <Skeleton className="h-14 flex-1" />
      ) : !usable || error ? (
        <p className="flex-1 text-sm text-muted-foreground italic">
          {forecast?.status === 'UNKNOWN_METRIC' ? 'Metric not tracked yet' : 'Not enough signal yet'}
        </p>
      ) : (
        <ChartContainer config={chartConfig} className="h-14 flex-1 aspect-auto">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide domain={['auto', 'auto']} />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="line" labelFormatter={(value) => String(value)} />}
            />
            <Area
              dataKey="band"
              type="monotone"
              stroke="none"
              fill="var(--color-band)"
              fillOpacity={0.18}
              isAnimationActive={false}
            />
            <Line
              dataKey="q50"
              type="monotone"
              stroke="var(--color-q50)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      )}
    </div>
  );
}

/** Compact q10–q90 band + q50 line strips for the Daily Feature Store metrics. */
export function MetricForecastPanel() {
  return (
    <Card>
      <Card.Header>
        <Card.Title>Metric Forecasts</Card.Title>
        <Card.Description>Three-day outlook per daily metric (q10–q90 band, q50 line).</Card.Description>
      </Card.Header>
      <Card.Content className="divide-y divide-border">
        {METRIC_SPECS.map((spec) => (
          <MetricStrip key={spec.metric} spec={spec} />
        ))}
      </Card.Content>
    </Card>
  );
}
