interface DayEvent {
  id: string;
  title?: string | null;
  startTime: string;
  endTime?: string | null;
  eventType?: string | null;
  taskId?: string | null;
}

function formatClock(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function DaySchedule({ events }: { events: DayEvent[] }) {
  if (events.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">On the calendar</h2>
        <p className="mt-1 text-sm text-muted-foreground">Nothing on the calendar yet. Schedule a task below.</p>
      </section>
    );
  }

  const sorted = [...events].sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        On the calendar
        <span className="ml-2 font-normal">{sorted.length}</span>
      </h2>
      <ol className="flex flex-col gap-1">
        {sorted.map((event) => {
          const planned = event.eventType === 'planned_block';
          const end = event.endTime ? `–${formatClock(event.endTime)}` : '';

          return (
            <li
              key={event.id}
              className="flex items-baseline gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatClock(event.startTime)}
                {end}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{event.title || 'Untitled'}</span>
              {planned ? <span className="shrink-0 text-xs text-teal-600 dark:text-teal-400">Planned</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
