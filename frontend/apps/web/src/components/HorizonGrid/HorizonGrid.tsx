import { cn, Tooltip } from '@ci/shadcn';

import type { RhythmDay, ScheduleEvent } from '@/api/useScheduleService';

// ── Constants ─────────────────────────────────────────────────────────────────

const MINUTES_PER_DAY = 24 * 60;

/**
 * HBPE bins behaviour into four 6-hour dayparts anchored at UTC midnight
 * (recurrence.py: BUCKETS_PER_PART = 12). We place each band by its real UTC
 * instant and let it land wherever it falls on the viewer's local axis, rather
 * than pretending "morning" means the viewer's morning.
 */
const DAYPART_HOURS = 6;
const DAYPART_NAMES = ['night', 'morning', 'afternoon', 'evening'] as const;

/** Below this weight, a rhythm band is noise rather than signal — don't ink it. */
const BAND_NOISE_FLOOR = 0.05;

/**
 * Ink range for a band's weight. The floor keeps a weak-but-real pattern
 * visible; the ceiling keeps the rhythm layer ambient, so it never competes
 * with committed time for attention. Weight maps linearly across the range
 * rather than being clamped, so a 0.9 band still reads darker than a 0.6 one.
 */
const MIN_BAND_INK = 0.12;
const MAX_BAND_INK = 0.7;

function bandOpacity(intensity: number): number {
  return MIN_BAND_INK + (MAX_BAND_INK - MIN_BAND_INK) * Math.min(intensity, 1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function localMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);

  return d;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Below this share of the row, a block is too narrow to hold its own title — a
 * 30-minute meeting is 2% of a 24-hour day. Such events render as a tick with
 * the label spilling to the right instead of being truncated to one letter.
 */
const NARROW_SPAN_PCT = 7;

/** A committed event's placement on one day row, clipped to that day. */
interface EventSpan {
  event: ScheduleEvent;
  leftPct: number;
  widthPct: number;
  /** True when the event began before this day — it ran in from yesterday. */
  continuesFrom: boolean;
  continuesTo: boolean;
}

/**
 * Clip an event to a single local day and express it as percentages of that row.
 *
 * A flight that departs Sunday night and lands Monday morning must appear on
 * both rows; that is why this clips rather than filters. Zero-length and all-day
 * events get a floor width so they stay clickable.
 */
function spanForDay(event: ScheduleEvent, dayStart: Date): EventSpan | null {
  const dayEnd = addDays(dayStart, 1);
  const start = new Date(event.startTime);
  const end = event.endTime ? new Date(event.endTime) : start;

  if (Number.isNaN(start.getTime())) {
    return null;
  }

  if (start >= dayEnd || end < dayStart) {
    return null;
  }

  if (event.isAllDay) {
    return { event, leftPct: 0, widthPct: 100, continuesFrom: false, continuesTo: false };
  }

  const clippedStart = start < dayStart ? dayStart : start;
  const clippedEnd = end > dayEnd ? dayEnd : end;

  const startMin = sameLocalDay(clippedStart, dayStart) ? localMinutes(clippedStart) : 0;
  const endMin = clippedEnd >= dayEnd ? MINUTES_PER_DAY : localMinutes(clippedEnd);

  const widthMin = Math.max(endMin - startMin, 20);

  return {
    event,
    leftPct: (startMin / MINUTES_PER_DAY) * 100,
    widthPct: Math.min((widthMin / MINUTES_PER_DAY) * 100, 100 - (startMin / MINUTES_PER_DAY) * 100),
    continuesFrom: start < dayStart,
    continuesTo: end > dayEnd,
  };
}

/** One 6-hour rhythm band placed on the local axis. */
interface RhythmBand {
  key: string;
  label: string;
  leftPct: number;
  widthPct: number;
  intensity: number;
}

/**
 * Collapse a day's clusters into four placed bands.
 *
 * A band's weight is the STRONGEST single claim on that daypart —
 * `max(pOccur × daypartProb)` — not the union of every claim.
 *
 * The union reads better in theory and is useless in practice: a real user has
 * ~20 discovered clusters, most with p_occur near 1 and probability mass spread
 * across all four dayparts, so a noisy-OR saturates every band to ~1.0 and the
 * layer degenerates into "everything, always". Taking the max asks the question
 * that actually carries information — how strongly does the most-expected
 * behaviour claim this part of the day — and leaves the bands differentiated.
 *
 * Bands are positioned by their true UTC instant, split at local midnight when
 * the offset pushes one across the boundary.
 */
function bandsForDay(day: RhythmDay | undefined, dayStart: Date): RhythmBand[] {
  if (!day) {
    return [];
  }

  const weight = [0, 0, 0, 0];

  for (const cluster of day.clusters) {
    for (const entry of cluster.daypartProbs) {
      const idx = DAYPART_NAMES.indexOf(entry.label as (typeof DAYPART_NAMES)[number]);

      if (idx >= 0) {
        weight[idx] = Math.max(weight[idx], cluster.pOccur * entry.probability);
      }
    }
  }

  const bands: RhythmBand[] = [];
  const dayEnd = addDays(dayStart, 1);

  DAYPART_NAMES.forEach((name, idx) => {
    const intensity = weight[idx];

    if (intensity < BAND_NOISE_FLOOR) {
      return;
    }

    // The UTC instant this daypart opens, on this forecast date.
    const utcStart = new Date(`${day.date}T00:00:00Z`);
    utcStart.setUTCHours(idx * DAYPART_HOURS);
    const utcEnd = new Date(utcStart.getTime() + DAYPART_HOURS * 3_600_000);

    // Clip into the local day; a band straddling local midnight yields one
    // visible piece here and its remainder on the neighbouring row.
    const from = utcStart < dayStart ? dayStart : utcStart;
    const to = utcEnd > dayEnd ? dayEnd : utcEnd;

    if (to <= from) {
      return;
    }

    const startMin = sameLocalDay(from, dayStart) ? localMinutes(from) : 0;
    const endMin = to >= dayEnd ? MINUTES_PER_DAY : localMinutes(to);

    if (endMin <= startMin) {
      return;
    }

    bands.push({
      key: `${day.date}-${name}`,
      label: name,
      leftPct: (startMin / MINUTES_PER_DAY) * 100,
      widthPct: ((endMin - startMin) / MINUTES_PER_DAY) * 100,
      intensity,
    });
  });

  return bands;
}

/** Top behaviours for a day, for the row tooltip. */
function topClusters(day: RhythmDay | undefined, limit = 3): RhythmCluster[] {
  return [...(day?.clusters ?? [])].sort((a, b) => b.pOccur - a.pOccur).slice(0, limit);
}

type RhythmCluster = RhythmDay['clusters'][number];

// ── Row ───────────────────────────────────────────────────────────────────────

interface DayRowProps {
  dayStart: Date;
  events: ScheduleEvent[];
  rhythm: RhythmDay | undefined;
  isToday: boolean;
}

function DayRow({ dayStart, events, rhythm, isToday }: DayRowProps) {
  const spans = events
    .map((event) => spanForDay(event, dayStart))
    .filter((span): span is EventSpan => span !== null)
    .sort((a, b) => a.leftPct - b.leftPct);

  const bands = bandsForDay(rhythm, dayStart);
  const clusters = topClusters(rhythm);

  /**
   * Room to the right of a narrow block before the next one starts. A tick with
   * its label spilling into empty space is readable; one spilling under the next
   * event is not, so the label is dropped and the tooltip carries it instead.
   */
  const labelRoom = (index: number): number => {
    const current = spans[index];
    const next = spans[index + 1];
    const until = next ? next.leftPct : 100;

    return until - (current.leftPct + current.widthPct);
  };

  return (
    <div className="flex items-start gap-3 border-t border-border py-2">
      <div className="w-11 shrink-0 pt-1">
        <div className={cn('text-xs', isToday ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {dayStart.toLocaleDateString([], { weekday: 'short' })}
        </div>
        <div className="text-[10px] text-muted-foreground">{dayStart.getDate()}</div>
      </div>

      <div className="min-w-0 flex-1">
        {/* Committed lane — solid cards. Certainty reads as opacity and edge. */}
        <div className="relative h-7">
          {spans.map(({ event, leftPct, widthPct, continuesFrom, continuesTo }, index) => {
            const isNarrow = widthPct < NARROW_SPAN_PCT;
            const showSpilledLabel = isNarrow && labelRoom(index) > NARROW_SPAN_PCT;

            return (
              <Tooltip key={`${event.id}-${dayStart.toDateString()}`}>
                <Tooltip.Trigger asChild>
                  <div
                    className={cn(
                      'absolute top-0 h-7 whitespace-nowrap border bg-background text-[11px] leading-[26px]',
                      'border-foreground/25 text-foreground',
                      isNarrow ? 'overflow-visible' : 'overflow-hidden px-1.5',
                      event.status === 'tentative' && 'border-dashed opacity-70',
                      continuesFrom ? 'rounded-l-none' : 'rounded-l',
                      continuesTo ? 'rounded-r-none' : 'rounded-r',
                    )}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    {isNarrow ? (
                      showSpilledLabel && (
                        <span className="pointer-events-none absolute left-[calc(100%+4px)] top-0 text-muted-foreground">
                          {event.title}
                        </span>
                      )
                    ) : (
                      <span>{event.title}</span>
                    )}
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Content side="top">
                  <div className="space-y-1 text-left">
                    <p className="text-xs font-medium">{event.title}</p>
                    <p className="text-[10px] opacity-75">
                      {event.isAllDay
                        ? 'All day'
                        : `${formatClock(new Date(event.startTime))}${
                            event.endTime ? ` – ${formatClock(new Date(event.endTime))}` : ''
                          }`}
                    </p>
                    {event.locationName && <p className="text-[10px] opacity-60">{event.locationName}</p>}
                    {event.status === 'tentative' && <p className="text-[10px] opacity-60">Tentative</p>}
                  </div>
                </Tooltip.Content>
              </Tooltip>
            );
          })}
        </div>

        {/* Rhythm lane — what this day usually holds. Ambient, never a task. */}
        <div className="relative mt-1 h-1.5">
          {bands.map((band) => (
            <Tooltip key={band.key}>
              <Tooltip.Trigger asChild>
                <div
                  className="absolute top-0 h-1.5 rounded-full bg-teal-500"
                  style={{
                    left: `${band.leftPct}%`,
                    // Inset so adjacent dayparts read as distinct bands rather
                    // than fusing into one uniform bar.
                    width: `calc(${band.widthPct}% - 5px)`,
                    opacity: bandOpacity(band.intensity),
                  }}
                />
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">
                <div className="w-48 space-y-1 text-left">
                  <p className="text-xs font-medium capitalize">{band.label}</p>
                  {clusters.length === 0 ? (
                    <p className="text-[10px] opacity-60">No established pattern yet.</p>
                  ) : (
                    clusters.map((cluster) => (
                      <div key={cluster.clusterId} className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] opacity-75">{cluster.name}</span>
                        <span className="shrink-0 text-[10px] tabular-nums opacity-60">
                          {Math.round(cluster.pOccur * 100)}%
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </Tooltip.Content>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface HorizonGridProps {
  /** First day of the window, local midnight. */
  start: Date;
  days: number;
  events: ScheduleEvent[];
  rhythm: RhythmDay[];
  className?: string;
}

const AXIS_MARKS = [0, 6, 12, 18];

/**
 * The week, as days-down / time-across.
 *
 * Days are rows rather than columns because a fuzzy time window is a horizontal
 * smear, and because it lets a week, a month, and a year share one geometry.
 */
export function HorizonGrid({ start, days, events, rhythm, className }: HorizonGridProps) {
  const today = startOfLocalDay(new Date());
  const rhythmByDate = new Map(rhythm.map((day) => [day.date, day]));

  return (
    <div className={cn('w-full', className)}>
      {/* Time axis */}
      <div className="flex items-center gap-3 pb-1">
        <div className="w-11 shrink-0" />
        <div className="relative h-4 flex-1">
          {AXIS_MARKS.map((hour) => (
            <span
              key={hour}
              className="absolute text-[10px] text-muted-foreground"
              style={{ left: `${(hour / 24) * 100}%` }}
            >
              {formatClock(new Date(2000, 0, 1, hour))}
            </span>
          ))}
        </div>
      </div>

      {Array.from({ length: days }, (_, i) => {
        const dayStart = addDays(start, i);
        // Forecast days are keyed by UTC calendar date; match on the same basis.
        const key = new Date(dayStart.getTime() - dayStart.getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 10);

        return (
          <DayRow
            key={dayStart.toISOString()}
            dayStart={dayStart}
            events={events}
            rhythm={rhythmByDate.get(key)}
            isToday={sameLocalDay(dayStart, today)}
          />
        );
      })}
    </div>
  );
}

export { spanForDay, bandsForDay, startOfLocalDay, addDays };
