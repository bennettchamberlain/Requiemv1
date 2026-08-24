import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react';

import { EmptyState, LoadingPage, useDeviceLayout, usePageTitle } from '@ci/common';
import { Button, IconButton, cn } from '@ci/shadcn';
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';

import { useRescheduleEvent } from '@/api/useRescheduleEvent';
import { type RhythmDay, type ScheduleEvent, useScheduleService } from '@/api/useScheduleService';
import { HorizonGrid, VerticalCalendar } from '@/components/HorizonGrid';
import { TodayNowNext, WeekDayChips } from '@/components/HorizonGrid/TodayNowNext';
import { PageContent } from '@/components/layout';
import { TaskSlate } from '@/components/TaskSlate';
import { usePlanTasks } from '@/pages/PlanPage/usePlanTasks';
import {
  type ActivityClass,
  type ColorMode,
  ACTIVITY_CLASSES,
  CLASS_LABEL,
  classColor,
  classifyEvent,
  normalizeClass,
  sourceColor,
  sourceLabel,
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
    return 'HBPE rhythm forecast is off — showing committed time only.';
  }

  if (!coversWindow) {
    return 'HBPE rhythm only covers the next seven days — this week shows committed time only.';
  }

  const updated = new Date(generatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

  return `Pattern rhythm (HBPE) from your history, updated ${updated}.`;
}

const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  type: 'Activity',
  source: 'Source',
};

type ScheduleLayout = 'horizon' | 'calendar';

const LAYOUT_LABEL: Record<ScheduleLayout, string> = {
  horizon: 'Horizon',
  calendar: 'Calendar',
};

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

      return sources.map((source) => ({
        key: source,
        color: sourceColor(source),
        label: sourceLabel(source),
      }));
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

export interface SchedulePageProps {
  /**
   * Rendered inside a host page (Today) that already owns the document title
   * and the page frame. Embedded, this contributes the schedule and nothing
   * else — PageContent is the page's scroll container, so a second one nests
   * its padding and its scrollbar inside the host's.
   */
  embedded?: boolean;
}

export function SchedulePage({ embedded = false }: SchedulePageProps = {}) {
  const { t } = useTranslation();
  const { isMobile } = useDeviceLayout();
  const [weekOffset, setWeekOffset] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [weekOpen, setWeekOpen] = useState(false);
  const [layout, setLayout] = useState<ScheduleLayout>('calendar');

  usePageTitle(embedded ? null : 'Schedule - Companion Intelligence');

  const { start, end } = useMemo(() => {
    const from = addDays(startOfLocalDay(new Date()), weekOffset * DAYS_IN_VIEW);

    return { start: from, end: addDays(from, DAYS_IN_VIEW) };
  }, [weekOffset]);

  const [selectedDay, setSelectedDay] = useState(start);

  useEffect(() => {
    setSelectedDay(start);
  }, [start]);

  const { events, rhythm, generatedAt, rhythmCoversWindow, loading, fetching, error, refetch } =
    useScheduleService(start, end);

  // Placing a backlog task mints a planned block, so the committed lane has to re-read.
  const {
    backlog,
    backlogCount,
    loading: planLoading,
    error: planError,
    placeOnDay,
    dismissProposed,
  } = usePlanTasks(refetch);

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
    (taskId: string, startTime: Date) => {
      run(placeOnDay(taskId, startTime), 'Could not put that on the calendar. Try again shortly.');
    },
    [placeOnDay, run],
  );

  const rescheduleEvent = useRescheduleEvent(refetch);

  const handleMove = useCallback(
    (eventId: string, startTime: Date) => {
      run(rescheduleEvent(eventId, startTime), 'Could not move that. Try again shortly.');
    },
    [rescheduleEvent, run],
  );

  const handleDismissProposed = useCallback(
    (id: string) => {
      run(dismissProposed(id), 'Could not dismiss that task. Try again shortly.');
    },
    [dismissProposed, run],
  );

  const goBack = useCallback(() => setWeekOffset((offset) => offset - 1), []);
  const goForward = useCallback(() => setWeekOffset((offset) => offset + 1), []);
  const goToday = useCallback(() => setWeekOffset(0), []);

  // `errorPolicy: 'all'` means an error and usable data can arrive together, so
  // the surface is gated on whether anything resolved rather than on `error`.
  const hasAnything = events.length > 0 || rhythm.length > 0 || backlogCount > 0;
  const isTrulyEmpty =
    !loading && !fetching && !hasAnything && !error && !planError && weekOffset === 0;
  const showScheduleSurface = weekOffset !== 0 || hasAnything || planError || fetching;

  // Embedded, the host supplies the frame, so this keeps only the column gap
  // and drops the safe-area top padding, which belongs to whatever is actually
  // at the top of the page.
  //
  // `relative` is not decoration: LoadingPage is `absolute inset-0 z-10`, so
  // without a positioned boundary here it anchors to the HOST's PageContent
  // and blankets the whole composed page — the schedule's spinner would cover
  // the brief below it. `min-h-60` gives that spinner somewhere to be, since
  // while it shows there is nothing else in this column to give the box height.
  //
  // `shrink-0` is what makes `min-h-60` safe. The host is a definite-height
  // flex column, and a flex item's default `min-height: auto` — its
  // content-based automatic minimum — is the only reason pages overflow and
  // scroll instead of squashing. Setting min-height REPLACES that automatic
  // minimum, which would re-enable shrinking: schedule and brief together
  // exceed any normal viewport, so both would be compressed below their
  // content, painting over each other and putting part of the page out of
  // scroll range. Refusing to shrink restores overflow-and-scroll.
  //
  // `PageContent` is a stable module-level reference and `'div'` is a string,
  // so `Frame` keeps the same element type across renders — no remounting, and
  // `weekOffset` / `selectedDay` survive the host re-rendering.
  const Frame: ElementType = embedded ? 'div' : PageContent;

  const layoutToggle = (
    <div
      role="tablist"
      aria-label="Schedule layout"
      className="flex shrink-0 items-center rounded-md border border-border p-0.5"
    >
      {(['calendar', 'horizon'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={layout === mode}
          title={
            mode === 'horizon' ? 'Days as rows, time across' : 'Hours down, like a typical calendar'
          }
          onClick={() => setLayout(mode)}
          className={cn(
            'rounded-[4px] px-2 py-0.5 text-[11px] leading-none transition-colors',
            layout === mode
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {LAYOUT_LABEL[mode]}
        </button>
      ))}
    </div>
  );

  const colorModeToggle = (
    <div
      role="radiogroup"
      aria-label={
        colorMode === 'type'
          ? 'Colour by activity type — what kind of activity'
          : 'Colour by source — which calendar or connector'
      }
      title={colorMode === 'type' ? 'What kind of activity' : 'Which calendar or connector'}
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
            'rounded-[4px] px-2 py-0.5 text-[11px] leading-none transition-colors',
            colorMode === mode
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {COLOR_MODE_LABEL[mode]}
        </button>
      ))}
    </div>
  );

  // Week chrome: range, legend, activity/source. Lives under the TimelineJS
  // today strip and immediately above the week so it sits next to schedule /
  // rhythm instead of floating above the zoomable story.
  const weekChrome = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex items-center gap-0.5">
        <IconButton variant="ghost" label={t('SCHEDULE_PREVIOUS_WEEK')} onClick={goBack}>
          <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
        </IconButton>
        <h2 className="min-w-[9rem] text-center text-base font-semibold text-foreground tabular-nums">
          {formatRange(start, end)}
        </h2>
        <IconButton variant="ghost" label={t('SCHEDULE_NEXT_WEEK')} onClick={goForward}>
          <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
        </IconButton>
      </div>

      {weekOffset !== 0 && (
        <Button variant="ghost" size="sm" onClick={goToday} className="h-7 text-xs">
          Back to today
        </Button>
      )}

      {/* Hue answers one question at a time; this picks which one. Committed
          time and rhythm stay told apart by their lanes and by fill weight,
          so colour is free to carry category instead of certainty. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <ScheduleLegend mode={colorMode} events={events} rhythm={rhythm} />
        {layoutToggle}
        {colorModeToggle}
      </div>
    </div>
  );

  return (
    <>
      <Frame className={embedded ? 'relative flex min-h-60 w-full min-w-0 shrink-0 flex-col gap-3' : 'gap-3'}>
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
          <>
            {weekChrome}
            <EmptyState
              icon={<CalendarRange size={48} strokeWidth={1} />}
              message="Nothing here yet. Connect a calendar and your week will start to fill in."
            />
          </>
        )}

        {showScheduleSurface && (
          <>
            {/* Week chrome, then the week, then Possibilities. On a phone the
                horizon opens as day chips plus one row; now/next sits above. */}
            <div className={cn('flex flex-col', isMobile ? 'gap-3' : 'gap-4')}>
              {layout === 'horizon' && isMobile && (
                <TodayNowNext events={events} day={selectedDay} onShowMore={() => setWeekOpen(true)} />
              )}

              {isMobile ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="flex items-center gap-0.5">
                      <IconButton variant="ghost" label={t('SCHEDULE_PREVIOUS_WEEK')} onClick={goBack}>
                        <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                      </IconButton>
                      <h2 className="min-w-[8rem] text-center text-sm font-semibold text-foreground tabular-nums">
                        {formatRange(start, end)}
                      </h2>
                      <IconButton variant="ghost" label={t('SCHEDULE_NEXT_WEEK')} onClick={goForward}>
                        <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
                      </IconButton>
                    </div>

                    {weekOffset !== 0 && (
                      <Button variant="ghost" size="sm" onClick={goToday} className="h-8 text-xs">
                        Back to today
                      </Button>
                    )}

                    {layout === 'horizon' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-8 text-xs"
                        aria-expanded={weekOpen}
                        onClick={() => setWeekOpen((open) => !open)}
                      >
                        {weekOpen ? (
                          <ChevronUp className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} />
                        ) : (
                          <ChevronDown className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} />
                        )}
                        {weekOpen ? 'Hide week' : 'Show week'}
                      </Button>
                    )}
                  </div>

                  {(layout === 'calendar' || !weekOpen) && (
                    <WeekDayChips
                      start={start}
                      days={DAYS_IN_VIEW}
                      selectedDay={selectedDay}
                      onSelectDay={setSelectedDay}
                    />
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                    {weekOpen && layout === 'horizon' && (
                      <ScheduleLegend mode={colorMode} events={events} rhythm={rhythm} />
                    )}
                    {layoutToggle}
                    {colorModeToggle}
                  </div>
                </div>
              ) : (
                weekChrome
              )}

              {layout === 'calendar' ? (
                <VerticalCalendar
                  start={isMobile ? selectedDay : start}
                  days={isMobile ? 1 : DAYS_IN_VIEW}
                  events={events}
                  rhythm={rhythm}
                  colorMode={colorMode}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  onDropCandidate={handleDrop}
                  onMoveEvent={handleMove}
                  footer={rhythmFooter(generatedAt, rhythmCoversWindow)}
                />
              ) : (
                <HorizonGrid
                  start={isMobile && !weekOpen ? selectedDay : start}
                  days={isMobile && !weekOpen ? 1 : DAYS_IN_VIEW}
                  events={events}
                  rhythm={rhythm}
                  colorMode={colorMode}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  onDropCandidate={handleDrop}
                  onMoveEvent={handleMove}
                  footer={rhythmFooter(generatedAt, rhythmCoversWindow)}
                />
              )}

              <TaskSlate
                sections={backlog}
                loading={planLoading}
                error={planError}
                onDismissProposed={handleDismissProposed}
              />
            </div>
          </>
        )}
      </Frame>
    </>
  );
}
