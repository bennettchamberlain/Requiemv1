import { useMemo } from 'react';

import { Badge, Card, Skeleton } from '@ci/shadcn';
import { Bar, ComposedChart, Line, LineChart, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

import { useCalibration } from './api';
import { calibrationOneLiner } from './calibrationModel';

const reliabilityConfig = {
  accuracy: { label: 'Observed accuracy', color: 'var(--chart-1)' },
  midpoint: { label: 'Perfect calibration', color: 'var(--chart-3)' },
} satisfies ChartConfig;

const trendConfig = {
  l0Top1Acc: { label: 'Top-1 accuracy', color: 'var(--chart-2)' },
  brier: { label: 'Brier', color: 'var(--chart-5)' },
} satisfies ChartConfig;

function formatPct(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

/**
 * Reliability diagram + Brier/accuracy trend + coverage/drift for the HBPE
 * live scoring loop. These metrics measure self-consistency against the
 * pipeline's own derived labels (`basis`), so the copy never claims ground
 * truth.
 */
export function CalibrationPanel() {
  const { calibration, loading } = useCalibration();

  const latest = calibration?.latest ?? null;

  const reliabilityData = useMemo(
    () =>
      (latest?.reliability ?? [])
        .filter((bin) => bin.count > 0)
        .map((bin) => ({
          range: `${Math.round(bin.lower * 100)}–${Math.round(bin.upper * 100)}%`,
          accuracy: bin.accuracy,
          midpoint: (bin.lower + bin.upper) / 2,
        })),
    [latest],
  );

  const trendData = useMemo(
    () =>
      [...(calibration?.history ?? [])]
        .reverse()
        .map((run) => ({ scoredAt: run.scoredAt, l0Top1Acc: run.l0Top1Acc, brier: run.brier })),
    [calibration],
  );

  const oneLiner = calibrationOneLiner(
    latest
      ? {
          brier: latest.brier ?? null,
          l0Top1Acc: latest.l0Top1Acc ?? null,
          ece: latest.ece ?? null,
          coverage: latest.coverage ?? null,
          driftFlag: latest.driftFlag,
          nBuckets: latest.nBuckets,
        }
      : null,
  );

  return (
    <Card>
      <Card.Header>
        <Card.Title>Calibration</Card.Title>
        <Card.Description>{oneLiner}</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4">
        {loading && !calibration ? (
          <div className="space-y-2" data-testid="calibration-skeleton">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !latest ? (
          <p className="text-sm text-muted-foreground">
            No scoring runs yet — calibration appears after forecasts have been checked against a few elapsed
            days.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Accuracy </span>
                <span className="font-medium tabular-nums">{formatPct(latest.l0Top1Acc)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Brier </span>
                <span className="font-medium tabular-nums">
                  {latest.brier == null ? '—' : latest.brier.toFixed(3)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Coverage </span>
                <span className="font-medium tabular-nums">{formatPct(latest.coverage)}</span>
              </div>
              <Badge variant={latest.driftFlag ? 'destructive' : 'outline'}>
                {latest.driftFlag ? 'Drift detected' : 'No drift'}
              </Badge>
            </div>

            {reliabilityData.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  Reliability — bars should track the dashed diagonal
                </p>
                <ChartContainer config={reliabilityConfig} className="h-36 w-full aspect-auto">
                  <ComposedChart data={reliabilityData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <XAxis dataKey="range" tickLine={false} axisLine={false} fontSize={9} />
                    <YAxis hide domain={[0, 1]} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                    <Bar
                      dataKey="accuracy"
                      fill="var(--color-accuracy)"
                      radius={2}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="midpoint"
                      stroke="var(--color-midpoint)"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ChartContainer>
              </div>
            )}

            {trendData.length > 1 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Accuracy & Brier trend</p>
                <ChartContainer config={trendConfig} className="h-16 w-full aspect-auto">
                  <LineChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <XAxis dataKey="scoredAt" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                    <Line
                      dataKey="l0Top1Acc"
                      stroke="var(--color-l0Top1Acc)"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="brier"
                      stroke="var(--color-brier)"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Measures self-consistency against the model's own derived labels — not ground truth.
            </p>
          </>
        )}
      </Card.Content>
    </Card>
  );
}
