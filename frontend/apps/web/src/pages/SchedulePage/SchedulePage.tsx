import { useCallback, useMemo, useState } from 'react';

import { EmptyState, LoadingPage, Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, cn } from '@ci/shadcn';
import { CalendarRange, ChevronLeft, ChevronRight } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import { useRescheduleEvent } from '@/api/useRescheduleEvent';
import { useScheduleCandidates } from '@/api/useScheduleCandidates';
import { type RhythmDay, type ScheduleEvent, useScheduleService } from '@/api/useScheduleService';
import { HorizonGrid } from '@/components/HorizonGrid';
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
} from '@/components/HorizonGrid/activityPalette';
import { PageContent } from '@/components/layout';
import { TaskSlate } from '@/components/TaskSlate';

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

  const { events, rhythm, generatedAt, loading, error, refetch } = useScheduleService(start, end);

  // Placing a candidate mints an event, so the committed lane has to re-read.
  const {
    candidates,
    loading: candidatesLoading,
    accept,
    decline,
    snooze,
  } = useScheduleCandidates(start, end, refetch);

  const handleDrop = useCallback(
    (candidateId: string, startTime: Date) => {
      void accept(candidateId, startTime);
    },
    [accept],
  );

  const rescheduleEvent = useRescheduleEvent(refetch);

  const handleMove = useCallback(
    (eventId: string, startTime: Date) => {
      void rescheduleEvent(eventId, startTime);
    },
    [rescheduleEvent],
  );

  const goBack = useCallback(() => setWeekOffset((offset) => offset - 1), []);
  const goForward = useCallback(() => setWeekOffset((offset) => offset + 1), []);
  const goToday = useCallback(() => setWeekOffset(0), []);

  const isEmpty = !loading && events.length === 0 && rhythm.length === 0;

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
          <h2 className="text-2xl font-bold text-foreground">{formatRange(start, end)}</h2>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous week" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToday}
              className={cn('text-xs', weekOffset === 0 && 'text-muted-foreground')}
              disabled={weekOffset === 0}
            >
              Today
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next week" onClick={goForward}>
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          </div>

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

        {loading && events.length === 0 && <LoadingPage />}

        {error && !loading && (
          <p className="text-sm text-muted-foreground">Could not load the schedule. Try again shortly.</p>
        )}

        {isEmpty && !error && candidates.length === 0 && (
          <EmptyState
            icon={<CalendarRange size={48} strokeWidth={1} />}
            message="Nothing here yet. Connect a calendar and your week will start to fill in."
          />
        )}

        {(!isEmpty || candidates.length > 0) && !error && (
          <>
            {/* Possibilities sit beside the week on a wide screen and beneath it
                on a narrow one — dragging needs both visible at once. The row
                stretches, so the two cards are one box height and end on the
                same line. */}
            <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
              <HorizonGrid
                start={start}
                days={DAYS_IN_VIEW}
                events={events}
                rhythm={rhythm}
                colorMode={colorMode}
                onDropCandidate={handleDrop}
                onMoveEvent={handleMove}
                className="min-w-0 flex-1"
                footer={
                  generatedAt
                    ? `Rhythm from your own patterns, updated ${new Date(generatedAt).toLocaleDateString(
                        [],
                        { month: 'short', day: 'numeric' },
                      )}.`
                    : 'Rhythm layer unavailable — showing committed time only.'
                }
              />

              <TaskSlate
                candidates={candidates}
                loading={candidatesLoading}
                onDecline={decline}
                onSnooze={snooze}
                className="w-full xl:w-80 xl:shrink-0"
              />
            </div>
          </>
        )}
      </PageContent>
    </>
  );
}
