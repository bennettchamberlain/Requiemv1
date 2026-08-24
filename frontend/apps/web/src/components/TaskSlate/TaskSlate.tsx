import { useState } from 'react';

import { useDeviceLayout } from '@ci/common';
import { Button, cn, Tabs, Tooltip } from '@ci/shadcn';
import { GripVertical, X } from '@ci/shadcn/icons';

import { CANDIDATE_DRAG_TYPE } from '@/lib/scheduleDrag';
import { type Section, type SectionedTask } from '@/pages/PlanPage/taskSections';
import type { PlanTask } from '@/pages/PlanPage/usePlanTasks';

export { CANDIDATE_DRAG_TYPE };

function formatDue(dueAt: string | Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(dueAt));
}

function overdueCount<T extends SectionedTask>(section: Section<T>): number {
  return section.lanes.find((lane) => lane.key === 'overdue')?.tasks.length ?? 0;
}

interface CardProps {
  task: PlanTask;
  /** Proposed inbox items can be declined; unscheduled work is only placed. */
  onDismiss?: (id: string) => void;
}

function BacklogCard({ task, onDismiss }: CardProps) {
  const proposed = task.status === 'proposed' || Boolean(task.hasPendingChange);

  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(CANDIDATE_DRAG_TYPE, task.id);
        event.dataTransfer.setData('text/plain', task.title);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'group relative flex flex-col rounded-lg border border-border bg-background',
        'cursor-grab p-2.5 pl-7 transition-colors hover:border-primary/50 active:cursor-grabbing',
      )}
    >
      <GripVertical
        className="absolute left-1.5 top-3 h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground pointer-coarse:text-muted-foreground/70"
        strokeWidth={1.5}
        aria-hidden
      />

      <p className="text-[13px] leading-snug text-foreground">{task.title}</p>

      {onDismiss && proposed ? (
        <div
          className={cn(
            'absolute bottom-1.5 right-2.5 z-10 flex items-center rounded-md',
            'border border-border/60 bg-background/95 px-0.5 shadow-sm backdrop-blur-sm',
            'pointer-events-none opacity-0 transition-opacity',
            'group-hover:pointer-events-auto group-hover:opacity-100',
            'focus-within:pointer-events-auto focus-within:opacity-100',
            'pointer-coarse:pointer-events-auto pointer-coarse:opacity-100',
          )}
        >
          <Tooltip>
            <Tooltip.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 pointer-coarse:h-8 pointer-coarse:w-8"
                aria-label={`Dismiss ${task.title}`}
                onClick={() => onDismiss(task.id)}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side="top">Dismiss</Tooltip.Content>
          </Tooltip>
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-1 pt-1.5">
        {proposed ? (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">proposed</span>
        ) : null}
        {task.dueAt ? (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
            Due {formatDue(task.dueAt)}
          </span>
        ) : null}
        {task.estimatedMinutes ? (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground tabular-nums">
            {task.estimatedMinutes}m
          </span>
        ) : null}
      </div>
    </li>
  );
}

function BacklogColumn({
  section,
  onDismiss,
  showHeading = true,
}: {
  section: Section<PlanTask>;
  onDismiss?: (id: string) => void;
  showHeading?: boolean;
}) {
  const overdue = overdueCount(section);
  const dismiss = section.key === 'proposed' ? onDismiss : undefined;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {showHeading ? (
        <h4 className="shrink-0 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {section.label}
          <span className="ml-2 font-normal">{section.tasks.length}</span>
          {overdue > 0 ? (
            <span className="ml-2 font-normal normal-case tracking-normal text-destructive">
              {overdue} overdue
            </span>
          ) : null}
        </h4>
      ) : overdue > 0 ? (
        <p className="px-1 pb-2 text-xs text-destructive">{overdue} overdue</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {section.lanes.map((lane) => (
          <div key={lane.key} className="flex flex-col gap-2">
            {lane.label ? (
              <h5
                className={cn(
                  'shrink-0 px-1 text-[11px] font-semibold uppercase tracking-wide',
                  lane.key === 'overdue' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {lane.label}
                <span className="ml-2 font-normal">{lane.tasks.length}</span>
              </h5>
            ) : null}
            <ul className="flex flex-col gap-2">
              {lane.tasks.map((task) => (
                <BacklogCard key={task.id} task={task} onDismiss={dismiss} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

interface TaskSlateProps {
  sections: Section<PlanTask>[];
  loading: boolean;
  /**
   * The Plan list could not be fetched. Distinct from an empty slate, and it
   * has to be: "nothing waiting yet" is a claim about the user's life, and
   * making it on the strength of a failed request is a lie.
   */
  error?: boolean;
  onDismissProposed?: (id: string) => void;
  className?: string;
}

/**
 * Proposed and Unscheduled work from Plan — the same two Kanban columns, sitting
 * under the week so a card is a short drag from a day.
 *
 * Scheduled and Done stay on the Plan board. Nothing here places itself; dropping
 * onto a day is the consent that turns a todo into committed time.
 */
export function TaskSlate({
  sections,
  loading,
  error = false,
  onDismissProposed,
  className,
}: TaskSlateProps) {
  const { isMobile } = useDeviceLayout();
  const [tab, setTab] = useState<string | null>(null);
  const hasCards = sections.some((section) => section.tasks.length > 0);
  const firstKey = sections[0]?.key;
  const activeTab = sections.some((section) => section.key === tab) ? tab! : firstKey;

  return (
    <div className={cn('rounded-xl border border-border bg-card p-3 md:p-4', className)}>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">Possibilities</h3>
        <span className="text-[11px] text-muted-foreground">
          {hasCards ? 'drag one onto a day above' : null}
        </span>
      </div>

      {loading && !hasCards ? (
        <p className="self-start text-[12px] text-muted-foreground">Loading your plan…</p>
      ) : null}

      {!loading && !hasCards && error ? (
        <p role="alert" className="max-w-md self-start text-[12px] leading-relaxed text-destructive">
          Could not load your plan. Try again shortly.
        </p>
      ) : null}

      {!loading && !hasCards && !error ? (
        <p className="max-w-md self-start text-[12px] leading-relaxed text-muted-foreground">
          Nothing in Proposed or Unscheduled. Add a task on the Plan page and it will show up here to
          drop onto a day.
        </p>
      ) : null}

      {hasCards && isMobile && activeTab ? (
        <Tabs value={activeTab} onValueChange={setTab} className="flex min-h-0 flex-col gap-3">
          <Tabs.List className="h-auto max-w-full justify-start overflow-x-auto">
            {sections.map((section) => (
              <Tabs.Trigger key={section.key} value={section.key} className="shrink-0">
                {section.label}
                <span className="ml-2 font-normal">{section.tasks.length}</span>
                {overdueCount(section) > 0 ? (
                  <span className="ml-2 font-normal text-destructive">{overdueCount(section)} overdue</span>
                ) : null}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {sections.map((section) => (
            <Tabs.Content key={section.key} value={section.key} className="max-h-72 overflow-hidden">
              <BacklogColumn section={section} onDismiss={onDismissProposed} showHeading={false} />
            </Tabs.Content>
          ))}
        </Tabs>
      ) : null}

      {hasCards && isMobile === false ? (
        <div className="flex max-h-72 min-h-0 gap-3 overflow-x-auto">
          {sections.map((section) => (
            <div
              key={section.key}
              className="flex min-w-[14rem] flex-1 flex-col rounded-lg border border-border bg-muted/30 px-2 py-2"
            >
              <BacklogColumn section={section} onDismiss={onDismissProposed} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
