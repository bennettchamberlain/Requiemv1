import { useMemo } from 'react';

import { Badge, Card, Skeleton, cn } from '@ci/shadcn';

import type { ForecastResponse } from '@/api/useForecastService';
import { L0_BG } from '@/components/ForecastStrip/ForecastStrip';
import { formatClock } from '@/components/PredictionHeatmap';

import { buildNextUp, type HistoryDay } from './nextUpModel';

interface NextUpPanelProps {
  forecast: ForecastResponse | null;
  forecastLoading: boolean;
  historyDays: HistoryDay[];
}

function DeltaBadge({ deltaPp }: { deltaPp: number | null }) {
  if (deltaPp == null) {
    return null;
  }

  const sign = deltaPp > 0 ? '+' : '';

  return (
    <Badge
      variant="outline"
      className={cn(
        'tabular-nums',
        deltaPp > 0 && 'text-green-600 dark:text-green-400',
        deltaPp < 0 && 'text-red-600 dark:text-red-400',
      )}
    >
      {sign}
      {deltaPp} pp
    </Badge>
  );
}

/**
 * The next few hours of the forecast as list rows, each with a delta badge vs
 * the baseline the past history days assigned to the same time slot. Deltas
 * are hidden (not faked) when there is not enough history.
 */
export function NextUpPanel({ forecast, forecastLoading, historyDays }: NextUpPanelProps) {
  const ready = forecast?.systemStatus === 'READY';
  const rows = useMemo(
    () => buildNextUp(ready ? (forecast?.buckets ?? []) : [], historyDays),
    [forecast, historyDays, ready],
  );

  return (
    <Card>
      <Card.Header>
        <Card.Title>Next Up</Card.Title>
        <Card.Description>The coming hours, with the shift vs your usual baseline.</Card.Description>
      </Card.Header>
      <Card.Content>
        {forecastLoading && !forecast ? (
          <div className="space-y-2" data-testid="next-up-skeleton">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No upcoming forecast yet — check back once the prediction engine is ready.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.startTime} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                  {formatClock(row.localMin)}
                </span>
                <span className={cn('h-3 w-3 shrink-0 rounded-sm', L0_BG[row.label] ?? 'bg-gray-400')} />
                <span className="min-w-0 flex-1 truncate">
                  {row.label}
                  {row.topL1 && row.topL1.probability > 0.1 && (
                    <span className="ml-1 text-muted-foreground">· {row.topL1.label.slice(0, 28)}</span>
                  )}
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                  {Math.round(row.probability * 100)}%
                </span>
                <DeltaBadge deltaPp={row.deltaPp} />
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
}
