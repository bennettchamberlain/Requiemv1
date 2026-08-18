import { Button, Checkbox, IconButton } from '@ci/shadcn';
import { Trash } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';

import { gql } from '@/graphql';
import { type FragmentType, useFragment } from '@/graphql/fragment-masking';

interface Props {
  task: FragmentType<typeof TaskRowFragment>;
  depth?: number;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onAcceptProposed?: (id: string) => void;
  onDeclineProposed?: (id: string) => void;
  pendingChangeId?: string | null;
  pendingRationale?: string | null;
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
  onAcceptProposed,
  onDeclineProposed,
  pendingChangeId,
  pendingRationale,
  onAcceptPending,
  onDeclinePending,
  children,
}: Props) {
  const { t } = useTranslation();
  const task = useFragment(TaskRowFragment, taskMasked);
  const done = task.status === 'done';
  const proposed = task.status === 'proposed';
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
              <Button size="sm" variant="outline" onClick={() => onDeclineProposed(task.id)}>
                Dismiss
              </Button>
            </div>
          ) : null}

          {pendingChangeId && onAcceptPending && onDeclinePending ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" variant="default" onClick={() => onAcceptPending(pendingChangeId)}>
                Confirm
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDeclinePending(pendingChangeId)}>
                Ignore
              </Button>
            </div>
          ) : null}
        </div>

        <IconButton
          onClick={(e) => onDelete(e, task.id)}
          variant="ghost"
          label={t('PLAN_TASK_DELETE', { title: task.title })}
        >
          <Trash className="h-4 w-4" />
        </IconButton>
      </div>

      {children ? <ul className="flex flex-col gap-2">{children}</ul> : null}
    </li>
  );
}
