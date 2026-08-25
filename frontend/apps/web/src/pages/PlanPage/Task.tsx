import { useState } from 'react';

import { Button, Checkbox, IconButton } from '@ci/shadcn';
import { CalendarRange, Pencil, Trash } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';

import { gql } from '@/graphql';
import { type FragmentType, useFragment } from '@/graphql/fragment-masking';

import { isOverdue, localDateOf } from './taskSections';
import { WhenSelector } from './WhenSelector';

interface Props {
  task: FragmentType<typeof TaskRowFragment>;
  depth?: number;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onEdit?: (
    e: React.MouseEvent,
    task: {
      id: string;
      title: string;
      description?: string | null;
      dueAt?: string | null;
      estimatedMinutes?: number | null;
    },
  ) => void;
  onAcceptProposed?: (id: string) => void;
  onDeclineProposed?: (id: string) => void;
  onAcceptAndSchedule?: (id: string) => void;
  onSchedule?: (id: string) => void;
  /** Move an overdue task onto a user-local `YYYY-MM-DD`. */
  onReschedule?: (id: string, date: string) => void;
  pendingChangeId?: string | null;
  pendingRationale?: string | null;
  pendingKind?: string | null;
  onAcceptPending?: (changeId: string) => void;
  onDeclinePending?: (changeId: string) => void;
  children?: React.ReactNode;
}

export const TaskRowFragment = gql(`
  fragment TaskRowFragment on TaskType {
    id
    title
    description
    status
    priority
    parentId
    dueAt
    scheduledFor
    deferUntil
    estimatedMinutes
    completedAt
  }
`);

const PRIORITY_LABELS: Record<number, string> = {
  0: 'Critical',
  1: 'High',
  2: 'Elevated',
  4: 'Low',
  5: 'Lowest',
};

/** `2026-01-15T17:00:00Z` -> `Jan 15`, in the viewer's own zone. */
function formatDue(dueAt: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(dueAt));
}

export function Task({
  task: taskMasked,
  depth = 0,
  onToggle,
  onDelete,
  onEdit,
  onAcceptProposed,
  onDeclineProposed,
  onAcceptAndSchedule,
  onSchedule,
  onReschedule,
  pendingChangeId,
  pendingRationale,
  pendingKind,
  onAcceptPending,
  onDeclinePending,
  children,
}: Props) {
  const { t } = useTranslation();
  const task = useFragment(TaskRowFragment, taskMasked);
  const done = task.status === 'done';
  const proposed = task.status === 'proposed';
  const overdue = isOverdue(task, localDateOf(new Date()));
  const [pickingWhen, setPickingWhen] = useState(false);
  const priorityLabel = PRIORITY_LABELS[task.priority];

  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm transition-shadow hover:shadow-md"
      style={{ marginLeft: depth > 0 ? `${depth * 1.25}rem` : undefined }}
    >
      <div className="flex items-start gap-3">
        {!proposed ? (
          <Checkbox
            className="mt-1"
            checked={done}
            onCheckedChange={(checked) => onToggle(task.id, checked === true)}
            aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          />
        ) : (
          <span className="mt-1 inline-flex h-4 w-4 shrink-0 rounded-sm border border-dashed border-muted-foreground/50" />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`truncate font-medium ${done ? 'text-muted-foreground line-through' : ''}`}>
            {task.title}
          </span>

          {task.description ? (
            <span className="line-clamp-2 text-sm text-muted-foreground">{task.description}</span>
          ) : null}

          {pendingRationale ? (
            <span className="text-sm text-amber-700 dark:text-amber-300">{pendingRationale}</span>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {proposed ? <span>Proposed</span> : null}
            {task.dueAt ? <span>Due {formatDue(task.dueAt as string)}</span> : null}
            {task.scheduledFor ? <span>Planned {task.scheduledFor}</span> : null}
            {task.estimatedMinutes ? <span>{task.estimatedMinutes} min</span> : null}
            {priorityLabel ? <span>{priorityLabel}</span> : null}
          </div>

          {proposed && onAcceptProposed && onDeclineProposed ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" variant="default" onClick={() => onAcceptProposed(task.id)}>
                Add to plan
              </Button>
              {onAcceptAndSchedule ? (
                <Button size="sm" variant="secondary" onClick={() => onAcceptAndSchedule(task.id)}>
                  Add and schedule
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => onDeclineProposed(task.id)}>
                Dismiss
              </Button>
            </div>
          ) : null}

          {!proposed && !done && overdue && onReschedule ? (
            pickingWhen ? (
              <WhenSelector
                onPick={(date) => {
                  setPickingWhen(false);
                  onReschedule(task.id, date);
                }}
                onCancel={() => setPickingWhen(false)}
              />
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setPickingWhen(true)}
                  aria-label={`Reschedule ${task.title}`}
                >
                  <CalendarRange className="h-4 w-4" />
                  Reschedule
                </Button>
              </div>
            )
          ) : null}

          {!proposed && !done && !overdue && !task.scheduledFor && onSchedule ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => onSchedule(task.id)}>
                <CalendarRange className="h-4 w-4" />
                Schedule
              </Button>
            </div>
          ) : null}

          {pendingChangeId && onAcceptPending && onDeclinePending ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" variant="default" onClick={() => onAcceptPending(pendingChangeId)}>
                {pendingKind === 'schedule' ? 'Place on calendar' : 'Confirm'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDeclinePending(pendingChangeId)}>
                Ignore
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onEdit ? (
            <IconButton
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit(e, {
                  id: task.id,
                  title: task.title,
                  description: task.description,
                  dueAt: task.dueAt as string | null,
                  estimatedMinutes: task.estimatedMinutes,
                });
              }}
              variant="ghost"
              label={t('PLAN_TASK_EDIT', { title: task.title })}
            >
              <Pencil className="h-4 w-4" />
            </IconButton>
          ) : null}
          <IconButton
            onClick={(e) => onDelete(e, task.id)}
            variant="ghost"
            label={t('PLAN_TASK_DELETE', { title: task.title })}
          >
            <Trash className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {children ? <ul className="flex flex-col gap-2">{children}</ul> : null}
    </li>
  );
}
