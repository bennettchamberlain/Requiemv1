import { cn, Tooltip } from '@ci/shadcn';

import { L0_BG } from '@/components/ForecastStrip/ForecastStrip';

import {
  HEATMAP_COLUMNS,
  MINUTES_PER_SLOT,
  formatClock,
  type HeatmapCell,
  type HeatmapCells,
} from './heatmapModel';

/** One heatmap row: a labelled local day of 48 half-hour cells. */
export interface HeatmapRow {
  key: string;
  label: string;
  /** 'history' rows show observed actuals; 'forecast' rows show predictions. */
  kind: 'history' | 'forecast';
  cells: HeatmapCells;
}

interface PredictionHeatmapProps {
  rows: HeatmapRow[];
  className?: string;
}

const COLUMN_LABEL_EVERY_SLOTS = 6; // one label per 3 hours

function CellTooltip({ cell, rowLabel }: { cell: HeatmapCell; rowLabel: string }) {
  const sorted = [...cell.predictedProbs].sort((a, b) => b.probability - a.probability);

  return (
    <div className="w-52 space-y-2 text-left">
      <p className="text-xs font-semibold">
        {rowLabel} · {formatClock(cell.localMin)} – {formatClock(cell.localMin + MINUTES_PER_SLOT)}
      </p>

      {cell.actualL0 && (
        <p className="text-[10px]">
          predicted {cell.predictedDominant ?? '—'} · actual {cell.actualL0}
          {cell.divergent && <span className="ml-1 opacity-75">(diverged)</span>}
        </p>
      )}

      <div className="space-y-1">
        {sorted.map(({ label, probability }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-right text-[10px] opacity-75">{label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-current/20 overflow-hidden">
              <div
                className={cn('h-full rounded-full', L0_BG[label] ?? 'bg-gray-400')}
                style={{ width: `${Math.round(probability * 100)}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-[10px] opacity-75 tabular-nums">
              {Math.round(probability * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapCellView({ cell, rowLabel }: { cell: HeatmapCell | null; rowLabel: string }) {
  if (!cell) {
    return <div className="h-6 bg-muted-foreground/10" style={{ opacity: 0.4 }} />;
  }

  return (
    <Tooltip>
      <Tooltip.Trigger asChild>
        <div
          className={cn(
            'h-6 cursor-default transition-transform duration-100 hover:scale-y-[1.25] hover:z-10 relative',
            L0_BG[cell.colorLabel] ?? 'bg-gray-400',
            cell.divergent && 'ring-2 ring-inset ring-foreground/70',
          )}
          style={{ opacity: cell.opacity }}
          data-divergent={cell.divergent || undefined}
        />
      </Tooltip.Trigger>
      <Tooltip.Content side="top" sideOffset={6} className="max-w-none p-3">
        <CellTooltip cell={cell} rowLabel={rowLabel} />
      </Tooltip.Content>
    </Tooltip>
  );
}

function ColumnLabels() {
  return (
    <>
      <div />
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: `repeat(${HEATMAP_COLUMNS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: HEATMAP_COLUMNS }, (_, column) => (
          <div key={column} className="text-[9px] text-muted-foreground whitespace-nowrap overflow-visible">
            {column % COLUMN_LABEL_EVERY_SLOTS === 0 ? formatClock(column * MINUTES_PER_SLOT) : ''}
          </div>
        ))}
      </div>
    </>
  );
}

function SectionSeam() {
  return (
    <>
      <div />
      <div className="flex items-center gap-2 py-1" role="separator" aria-label="actual / forecast seam">
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">observed</span>
        <div className="flex-1 border-t border-dashed border-border" />
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">forecast</span>
      </div>
    </>
  );
}

/**
 * Generalised ForecastStrip: a CSS grid of coloured divs, one labelled row per
 * day, 48 half-hour columns. Past rows render observed actuals at full opacity
 * (with a divergence ring where the prediction missed); forecast rows render
 * the dominant predicted class at confidence opacity. No chart library.
 */
export function PredictionHeatmap({ rows, className }: PredictionHeatmapProps) {
  const firstForecastIndex = rows.findIndex((row) => row.kind === 'forecast');

  return (
    <div
      role="img"
      aria-label="Weekly prediction heatmap"
      className={cn('grid gap-y-1 items-center', className)}
      style={{ gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: '0.5rem' }}
    >
      <ColumnLabels />

      {rows.map((row, rowIndex) => (
        <div key={row.key} className="contents">
          {rowIndex === firstForecastIndex && <SectionSeam />}

          <div className="text-[10px] text-muted-foreground whitespace-nowrap text-right pr-1">
            {row.label}
          </div>
          <div
            className="grid gap-px overflow-hidden rounded-sm"
            style={{ gridTemplateColumns: `repeat(${HEATMAP_COLUMNS}, minmax(0, 1fr))` }}
          >
            {row.cells.map((cell, column) => (
              <HeatmapCellView key={column} cell={cell} rowLabel={row.label} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
