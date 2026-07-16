import { useMemo } from 'react';

import { Card, Skeleton, cn } from '@ci/shadcn';

import type { ForecastResponse } from '@/api/useForecastService';
import { L0_BG } from '@/components/ForecastStrip/ForecastStrip';
import {
  PredictionHeatmap,
  buildForecastRows,
  buildHistoryCells,
  formatRowLabel,
  type HeatmapRow,
  type HistoryBucketLike,
} from '@/components/PredictionHeatmap';

import type { HistoryDay } from './nextUpModel';

const LEGEND_CLASSES = ['WORK', 'EXERCISE', 'SOCIAL', 'ERRAND', 'LEISURE', 'TRANSIT', 'SLEEP'] as const;

interface WeekHeatmapPanelProps {
  historyDays: HistoryDay[];
  historyLoading: boolean;
  forecast: ForecastResponse | null;
  forecastStalled: boolean;
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {LEGEND_CLASSES.map((cls) => (
        <div key={cls} className="flex items-center gap-1">
          <div className={cn('w-2 h-2 rounded-sm', L0_BG[cls])} />
          <span className="text-[10px] text-muted-foreground">{cls}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 7×48 week heatmap: five past days of observed actuals (divergence-ringed
 * where the prediction missed), a seam, then today + tomorrow from the live
 * forecast at confidence opacity.
 */
export function WeekHeatmapPanel({
  historyDays,
  historyLoading,
  forecast,
  forecastStalled,
}: WeekHeatmapPanelProps) {
  const rows = useMemo<HeatmapRow[]>(() => {
    const historyRows: HeatmapRow[] = historyDays.map((day) => ({
      key: day.date,
      label: formatRowLabel(day.date),
      kind: 'history',
      cells: buildHistoryCells(day.buckets as HistoryBucketLike[]),
    }));

    const forecastReady = forecast?.systemStatus === 'READY';
    const { todayKey, tomorrowKey, today, tomorrow } = buildForecastRows(
      forecastReady ? (forecast?.buckets ?? []) : [],
    );

    return [
      ...historyRows,
      { key: todayKey, label: formatRowLabel(todayKey), kind: 'forecast', cells: today },
      { key: tomorrowKey, label: formatRowLabel(tomorrowKey), kind: 'forecast', cells: tomorrow },
    ];
  }, [forecast, historyDays]);

  const hasAnyCell = rows.some((row) => row.cells.some((cell) => cell != null));

  return (
    <Card>
      <Card.Header>
        <Card.Title>Week at a Glance</Card.Title>
        <Card.Description>
          Observed days vs the live forecast — ringed cells are where the prediction missed.
        </Card.Description>
      </Card.Header>
      <Card.Content className="space-y-3">
        {historyLoading ? (
          <div className="space-y-1" data-testid="heatmap-skeleton">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <>
            <PredictionHeatmap rows={rows} />

            {!hasAnyCell && (
              <p className="text-sm text-muted-foreground">
                {forecastStalled
                  ? 'Prediction model not built yet — open Add ▸ Predict to start.'
                  : 'No forecasts logged yet — the heatmap fills in as the prediction engine runs.'}
              </p>
            )}

            <Legend />
          </>
        )}
      </Card.Content>
    </Card>
  );
}
