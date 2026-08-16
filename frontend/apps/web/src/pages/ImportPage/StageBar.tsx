import { cn } from '@ci/shadcn';

import { compactNumber, computeFraction, formatEta } from './runFormat';

export interface StageBarProps {
  /** Live numerator. */
  processed: number;
  /** Denominator; null means indeterminate — see below. */
  total: number | null | undefined;
  status: string;
  etaSeconds?: number | null;
  /** Thinner bar with no readout, for a compact list. */
  compact?: boolean;
  /** What the numbers count, when they are not records ("files", "people"). */
  unit?: string;
}

const FILL_BY_STATUS: Record<string, string> = {
  completed: 'bg-emerald-500',
  running: 'bg-primary',
  queued: 'bg-muted-foreground/40',
  failed: 'bg-destructive',
  cancelled: 'bg-muted-foreground/40',
  skipped: 'bg-muted-foreground/40',
};

/**
 * The progress primitive.
 *
 * It NEVER fabricates a percentage. When there is no denominator — a parse has
 * not finished discovering how many records an archive holds — it animates
 * indeterminately and shows the live count instead of a made-up width. The three
 * hand-rolled bars this replaced upstream each guessed differently (a hardcoded
 * 70%, a `Math.min(95, …)`, and no bar at all), which is how one import could
 * look 70% done and 8% done on two screens at once.
 */
export function StageBar({ processed, total, status, etaSeconds, compact, unit }: StageBarProps) {
  const fraction = computeFraction(processed, total);
  const running = status === 'running' || status === 'queued';
  // A completed stage reads full even when it never had a countable total.
  const determinate = fraction != null || status === 'completed';
  const widthPercent = status === 'completed' ? 100 : fraction != null ? Math.round(fraction * 100) : 100;

  const eta = running ? formatEta(etaSeconds) : null;

  let countLabel = '';

  if (total != null && total > 0) {
    countLabel = `${compactNumber(processed)} / ${compactNumber(total)}`;
  } else if (processed > 0) {
    countLabel = compactNumber(processed);
  }

  if (countLabel && unit) {
    countLabel += ` ${unit}`;
  }

  return (
    <div className={cn('w-full', compact ? 'space-y-0' : 'space-y-1')}>
      <div
        className={cn('w-full overflow-hidden rounded-full bg-muted', compact ? 'h-1' : 'h-2')}
        role="progressbar"
        aria-valuenow={determinate ? widthPercent : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={determinate ? undefined : 'Working'}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            FILL_BY_STATUS[status] ?? 'bg-muted-foreground/40',
            !determinate && running && 'animate-pulse',
          )}
          style={{ width: `${widthPercent}%` }}
        />
      </div>

      {!compact && (countLabel || eta) ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{countLabel}</span>
          {eta ? <span>{eta}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
