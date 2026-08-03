import { useCallback, useMemo, useState } from 'react';

import { EmptyState, LoadingPage, Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, cn } from '@ci/shadcn';
import { CalendarRange, ChevronLeft, ChevronRight } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import { useScheduleService } from '@/api/useScheduleService';
import { HorizonGrid } from '@/components/HorizonGrid';
import { PageContent } from '@/components/layout';

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

export function SchedulePage() {
  const [weekOffset, setWeekOffset] = useState(0);

  usePageTitle('Schedule - Companion Intelligence');

  const { start, end } = useMemo(() => {
    const from = addDays(startOfLocalDay(new Date()), weekOffset * DAYS_IN_VIEW);

    return { start: from, end: addDays(from, DAYS_IN_VIEW) };
  }, [weekOffset]);

  const { events, rhythm, generatedAt, loading, error } = useScheduleService(start, end);

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

          {/* The legend is the thesis: colour encodes certainty, not category. */}
          <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-[2px] border border-foreground/25 bg-background" />
              committed
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-[2px] bg-teal-500/50" />
              rhythm
            </span>
          </div>
        </div>

        {loading && events.length === 0 && <LoadingPage />}

        {error && !loading && (
          <p className="text-sm text-muted-foreground">Could not load the schedule. Try again shortly.</p>
        )}

        {isEmpty && !error && (
          <EmptyState
            icon={<CalendarRange size={48} strokeWidth={1} />}
            message="Nothing here yet. Connect a calendar and your week will start to fill in."
          />
        )}

        {!isEmpty && !error && (
          <>
            <HorizonGrid start={start} days={DAYS_IN_VIEW} events={events} rhythm={rhythm} />

            {generatedAt ? (
              <p className="pt-2 text-[10px] text-muted-foreground">
                Rhythm from your own patterns, updated{' '}
                {new Date(generatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}.
              </p>
            ) : (
              <p className="pt-2 text-[10px] text-muted-foreground">
                Rhythm layer unavailable — showing committed time only.
              </p>
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
