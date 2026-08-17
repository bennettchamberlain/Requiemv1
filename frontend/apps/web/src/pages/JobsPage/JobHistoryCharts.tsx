import { useMemo } from 'react';

import { Button, Card, Skeleton } from '@ci/shadcn';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

import { HISTORY_WINDOWS, type JobHistoryPoint, type JobHistoryResponse } from './useJobHistory';

type Props = {
  data: JobHistoryResponse | null;
  loading: boolean;
  error: string | null;
  windowHours: number;
  onWindowChange: (hours: number) => void;
  queue: string;
};

/**
 * What the queues have been doing over time.
 *
 * Three charts because there are three genuinely different questions, and one
 * chart type cannot answer them together:
 *
 *  - **Backlog (area)** — a GAUGE. "Is the queue draining or growing?" Only
 *    answerable against its own past, which is the entire reason
 *    `ci.job_metrics` exists.
 *  - **Throughput (bars)** — a DELTA. "How much settled, and how much of it
 *    failed?" Stacked, so the failure share is visible rather than being a
 *    second line to mentally subtract.
 *  - **Latency (line)** — "How long is a job taking?" Mean and p95 together,
 *    because a mean alone hides the tail that actually hurts: on this appliance
 *    image-description averages ~33s while search-index averages ~0.5s, and one
 *    aggregate number across both is meaningless.
 */
export function JobHistoryCharts({
  data,
  loading,
  error,
  windowHours,
  onWindowChange,
  queue,
}: Props) {
  const points = useMemo(() => (data?.points ?? []).map(toChartPoint), [data?.points]);

  const hasThroughput = points.some((point) => point.completed > 0 || point.failed > 0);
  const hasBacklog = points.some((point) => point.backlog > 0);
  const hasLatency = points.some((point) => point.avgSeconds != null || point.p95Seconds != null);

  return (
    <Card>
      <Card.Header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Card.Title className="text-base">History</Card.Title>
          <Card.Description>
            {queue ? `${queue} — ` : 'All queues — '}
            {data ? `${data.bucketMinutes}-minute buckets` : 'loading'}
          </Card.Description>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="History window">
          {HISTORY_WINDOWS.map((option) => (
            <Button
              key={option.hours}
              size="sm"
              variant={option.hours === windowHours ? 'secondary' : 'ghost'}
              aria-pressed={option.hours === windowHours}
              onClick={() => onWindowChange(option.hours)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </Card.Header>

      <Card.Content className="space-y-6">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load history: {error}
          </p>
        ) : null}

        {loading && !points.length ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !points.length ? (
          <p className="text-sm text-muted-foreground">
            No history recorded yet. Samples are written every 5 minutes — the first points appear
            once the collector has run.
          </p>
        ) : (
          <div className="grid gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Backlog"
              hint="Jobs waiting, running or retrying. Rising means work is arriving faster than it clears."
              empty={!hasBacklog}
              emptyMessage="No backlog recorded in this window."
            >
              <AreaChart data={points} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend {...LEGEND_PROPS} />
                <Area
                  type="monotone"
                  dataKey="pending"
                  name="Waiting"
                  stackId="backlog"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.25}
                />
                <Area
                  type="monotone"
                  dataKey="active"
                  name="Running"
                  stackId="backlog"
                  stroke="var(--chart-2)"
                  fill="var(--chart-2)"
                  fillOpacity={0.35}
                />
                <Area
                  type="monotone"
                  dataKey="retry"
                  name="Retrying"
                  stackId="backlog"
                  stroke="var(--chart-4)"
                  fill="var(--chart-4)"
                  fillOpacity={0.4}
                />
              </AreaChart>
            </ChartPanel>

            <ChartPanel
              title="Throughput"
              hint="Jobs that settled in each bucket. The red band is the share that failed."
              empty={!hasThroughput}
              emptyMessage="Nothing settled in this window."
            >
              <BarChart data={points} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                {/* Throughput is the one axis that reaches six figures during a
                    bulk import — a 44px gutter silently clipped "100000" to
                    "00000". Compact notation keeps it narrow AND readable. */}
                <YAxis
                  {...AXIS_PROPS}
                  width={52}
                  allowDecimals={false}
                  tickFormatter={formatCompact}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend {...LEGEND_PROPS} />
                <Bar dataKey="completed" name="Completed" stackId="flow" fill="var(--chart-2)" />
                <Bar dataKey="failed" name="Failed" stackId="flow" fill="var(--destructive)" />
              </BarChart>
            </ChartPanel>

            <ChartPanel
              title="Duration"
              hint="How long a job took. p95 alongside the mean, because the mean hides the tail."
              empty={!hasLatency}
              emptyMessage="No timing recorded in this window."
            >
              <LineChart data={points} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} width={52} unit="s" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend {...LEGEND_PROPS} />
                <Line
                  type="monotone"
                  dataKey="avgSeconds"
                  name="Mean"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="p95Seconds"
                  name="p95"
                  stroke="var(--chart-5)"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ChartPanel>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}

const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: 'var(--muted-foreground)' },
} as const;

const LEGEND_PROPS = {
  verticalAlign: 'bottom',
  height: 24,
  wrapperStyle: { fontSize: 11 },
} as const;

function ChartPanel({
  title,
  hint,
  empty,
  emptyMessage,
  children,
}: {
  title: string;
  hint: string;
  empty: boolean;
  emptyMessage: string;
  children: React.ReactElement;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      {empty ? (
        <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-border/60">
          <p className="text-xs text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <ChartContainer config={{}} className="h-[220px] w-full">
          {children}
        </ChartContainer>
      )}
    </div>
  );
}

type ChartPoint = {
  label: string;
  pending: number;
  active: number;
  retry: number;
  backlog: number;
  completed: number;
  failed: number;
  avgSeconds: number | null;
  p95Seconds: number | null;
};

function toChartPoint(point: JobHistoryPoint): ChartPoint {
  const at = new Date(point.at);

  return {
    label: Number.isNaN(at.getTime())
      ? '—'
      : new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(at),
    pending: point.pending,
    active: point.active,
    retry: point.retry,
    backlog: point.pending + point.active + point.retry,
    completed: point.completed,
    failed: point.failed,
    // Seconds, not milliseconds: a queue whose jobs take half a minute reads as
    // "33" rather than "33546", and the axis stays legible next to a queue
    // whose jobs take half a second.
    avgSeconds: point.avgDurationMs == null ? null : round(point.avgDurationMs / 1000),
    p95Seconds: point.p95DurationMs == null ? null : round(point.p95DurationMs / 1000),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 79,913 → "80K". Keeps a six-figure import inside a narrow axis gutter. */
function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}
