import { useCallback, useMemo, useState } from 'react';

import { EmptyState, LoadingPage, Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, cn } from '@ci/shadcn';
import { CalendarRange, ChevronLeft, ChevronRight } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import { useRescheduleEvent } from '@/api/useRescheduleEvent';
import { type DeclineReason, useScheduleCandidates } from '@/api/useScheduleCandidates';
import { type RhythmDay, type ScheduleEvent, useScheduleService } from '@/api/useScheduleService';
import { HorizonGrid } from '@/components/HorizonGrid';
import { PageContent } from '@/components/layout';
import { TaskSlate } from '@/components/TaskSlate';
import {
  type ActivityClass,
  type ColorMode,
  ACTIVITY_CLASSES,
  CLASS_LABEL,
  classColor,
  classifyEvent,
  normalizeClass,
  sourceColor,
  sourceOf,
} from '@/lib/activityPalette';

const DAYS_IN_VIEW = 7;

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

/** "Aug 3 – Aug 9" — the window, stated plainly. */
function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  return `${start.toLocaleDateString([], opts)} – ${addDays(end, -1).toLocaleDateString([], opts)}`;
}

/**
 * What the grid's footer is allowed to claim about the rhythm layer.
 *
 * `weekForecast` takes no date arguments, so the layer only ever describes the
 * seven days from today. Saying "updated <date>" over a lane that has nothing
 * to draw reads as "the model has learned nothing about you" — a different and
 * much worse statement than "this view cannot fetch that week".
 */
function rhythmFooter(generatedAt: string | null, coversWindow: boolean): string {
  if (!generatedAt) {
    return 'Rhythm layer unavailable — showing committed time only.';
  }

  if (!coversWindow) {
    return 'Rhythm only reaches seven days out — this window shows committed time only.';
  }

  const updated = new Date(generatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

  return `Rhythm from your own patterns, updated ${updated}.`;
}

/** One swatch + word. The word is why hue never carries identity alone. */
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/**
 * The key for what is actually on screen this week — not the whole vocabulary.
 *
 * Listing all eight classes when the week holds two is noise, and it would make
 * the legend the widest thing in the header.
 */
function ScheduleLegend({
  mode,
  events,
  rhythm,
}: {
  mode: ColorMode;
  events: ScheduleEvent[];
  rhythm: RhythmDay[];
}) {
  const keys = useMemo(() => {
    if (mode === 'source') {
      const sources = [...new Set(events.map(sourceOf))].sort();

      return sources.map((source) => ({ key: source, color: sourceColor(source), label: source }));
    }

    // Both lanes contribute: a class the rhythm predicts but you have not
    // committed to is exactly the kind of thing this page exists to show.
    const present = new Set<ActivityClass>(events.map(classifyEvent));

    for (const day of rhythm) {
      for (const cluster of day.clusters) {
        present.add(normalizeClass(cluster.l0Class));
      }
    }

    return ACTIVITY_CLASSES.filter((cls) => present.has(cls)).map((cls) => ({
      key: cls,
      color: classColor(cls),
      label: CLASS_LABEL[cls],
    }));
  }, [mode, events, rhythm]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {keys.map(({ key, color, label }) => (
        <LegendKey key={key} color={color} label={label} />
      ))}
    </div>
  );
}

export function SchedulePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('type');

  usePageTitle('Schedule - Companion Intelligence');

  const { start, end } = useMemo(() => {
    const from = addDays(startOfLocalDay(new Date()), weekOffset * DAYS_IN_VIEW);

    return { start: from, end: addDays(from, DAYS_IN_VIEW) };
  }, [weekOffset]);

  const { events, rhythm, generatedAt, rhythmCoversWindow, loading, fetching, error, refetch } =
    useScheduleService(start, end);

  // Placing a candidate mints an event, so the committed lane has to re-read.
  const {
    candidates,
    loading: candidatesLoading,
    error: candidatesError,
    accept,
    decline,
    snooze,
    breakDown,
    returnEvent,
  } = useScheduleCandidates(start, end, refetch);

  /**
   * Whatever a drag or a card button asked the server to do, and it refused.
   *
   * Every one of these mutations is fire-and-forget from the user's point of
   * view — the card stays on the rail, or the chip snaps back — so without this
   * a rejection is only ever visible in the console.
   */
  const [actionError, setActionError] = useState<string | null>(null);

  const run = useCallback((work: Promise<unknown>, message: string) => {
    setActionError(null);
    work.catch(() => setActionError(message));
  }, []);

  const handleDrop = useCallback(
    (candidateId: string, startTime: Date) => {
      run(accept(candidateId, startTime), 'Could not put that on the calendar. Try again shortly.');
    },
    [accept, run],
  );

  const rescheduleEvent = useRescheduleEvent(refetch);

  const handleMove = useCallback(
    (eventId: string, startTime: Date) => {
      run(rescheduleEvent(eventId, startTime), 'Could not move that. Try again shortly.');
    },
    [rescheduleEvent, run],
  );

  const handleDecline = useCallback(
    (id: string, reason: DeclineReason) => {
      run(decline(id, reason), 'Could not dismiss that suggestion. Try again shortly.');
    },
    [decline, run],
  );

  const handleSnooze = useCallback(
    (id: string, until: Date) => {
      run(snooze(id, until), 'Could not snooze that suggestion. Try again shortly.');
    },
    [snooze, run],
  );

  const handleReturnEvent = useCallback(
    (eventId: string) => {
      run(returnEvent(eventId), 'Could not take that off the week. Try again shortly.');
    },
    [returnEvent, run],
  );

  const goBack = useCallback(() => setWeekOffset((offset) => offset - 1), []);
  const goForward = useCallback(() => setWeekOffset((offset) => offset + 1), []);
  const goToday = useCallback(() => setWeekOffset(0), []);

  // `errorPolicy: 'all'` means an error and usable data can arrive together, so
  // the surface is gated on whether anything resolved rather than on `error`.
  const hasAnything = events.length > 0 || rhythm.length > 0 || candidates.length > 0;
  const isTrulyEmpty =
    !loading && !fetching && !hasAnything && !error && !candidatesError && weekOffset === 0;
  const showScheduleSurface = weekOffset !== 0 || hasAnything || candidatesError || fetching;

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/feed">Companion</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Schedule</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous week" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
            </Button>
            <h2 className="min-w-[9.5rem] text-center text-lg font-bold text-foreground tabular-nums">
              {formatRange(start, end)}
            </h2>
            <Button variant="ghost" size="icon" aria-label="Next week" onClick={goForward}>
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          </div>

          {weekOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={goToday} className="text-xs">
              Back to today
            </Button>
          )}

          {/* Hue answers one question at a time; this picks which one. Committed
              time and rhythm stay told apart by their lanes and by fill weight,
              so colour is free to carry category instead of certainty. */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <ScheduleLegend mode={colorMode} events={events} rhythm={rhythm} />

            <div
              role="radiogroup"
              aria-label="Colour by"
              className="flex shrink-0 items-center rounded-md border border-border p-0.5"
            >
              {(['type', 'source'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={colorMode === mode}
                  onClick={() => setColorMode(mode)}
                  className={cn(
                    'rounded-[4px] px-2 py-0.5 text-[11px] capitalize transition-colors',
                    colorMode === mode
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        {fetching && !hasAnything && <LoadingPage />}

        {actionError && (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        )}

        {error && !loading && (
          <p role="alert" className="text-sm text-muted-foreground">
            {hasAnything
              ? 'Part of this week could not be loaded — what is shown may be incomplete.'
              : 'Could not load the schedule. Try again shortly.'}
          </p>
        )}

        {isTrulyEmpty && (
          <EmptyState
            icon={<CalendarRange size={48} strokeWidth={1} />}
            message="Nothing here yet. Connect a calendar and your week will start to fill in."
          />
        )}

        {showScheduleSurface && (
          <>
            {/* Possibilities as a rail above the week, both full width. The
                week is what the page is about, so it gets the whole page; the
                rail stays one card deep above it and a drag runs downward onto
                a day, which is the shorter and more obvious gesture than the
                sideways one a column beside the grid asked for. */}
            <div className="flex flex-col gap-4">
              {weekOffset !== 0 && !hasAnything && !fetching && (
                <p className="text-sm text-muted-foreground">Nothing on the calendar this week.</p>
              )}

              <TaskSlate
                candidates={candidates}
                loading={candidatesLoading}
                error={candidatesError}
                onDecline={handleDecline}
                onSnooze={handleSnooze}
                onBreakDown={breakDown}
                onReturnEvent={handleReturnEvent}
              />

              <HorizonGrid
                start={start}
                days={DAYS_IN_VIEW}
                events={events}
                rhythm={rhythm}
                colorMode={colorMode}
                onDropCandidate={handleDrop}
                onMoveEvent={handleMove}
                footer={rhythmFooter(generatedAt, rhythmCoversWindow)}
              />
            </div>
          </>
        )}
      </PageContent>
    </>
  );
}
