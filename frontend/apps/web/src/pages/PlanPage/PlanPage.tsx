import { useMemo, useState, type ReactNode } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { EmptyState, LoadingPage, usePageTitle } from '@ci/common';
import { ListTodo } from '@ci/shadcn/icons';

import { useFeatures } from '@/common/feature';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

import { DaySchedule, type DayEvent } from './DaySchedule';
import { DeleteTaskModal } from './DeleteTaskModal';
import { EditEventModal } from './EditEventModal';
import { EditTaskModal, type EditableTask } from './EditTaskModal';
import { NewTaskForm } from './NewTaskForm';
import { Task } from './Task';
import { childrenOf, groupIntoSections, localDateOf, type SectionedTask } from './taskSections';

const GET_TASKS = gql(`
  query GetTasks($first: Int, $after: String) {
    tasks(first: $first, after: $after) {
      edges {
        node {
          id
          status
          priority
          parentId
          dueAt
          scheduledFor
          deferUntil
          title
          ...TaskRowFragment
        }
      }
      totalCount
    }
    taskPendingChanges {
      id
      taskId
      kind
      rationale
      confidence
      status
    }
  }
`);

const GET_PLAN_DAY = gql(`
  query GetPlanDay($from: DateTime!, $to: DateTime!) {
    eventsInRange(from: $from, to: $to) {
      id
      title
      startTime
      endTime
      eventType
      taskId
      status
    }
  }
`);

const COMPLETE_TASK = gql(`
  mutation CompleteTask($id: ID!) {
    completeTask(id: $id) {
      id
      status
      completedAt
    }
  }
`);

const REOPEN_TASK = gql(`
  mutation ReopenTask($id: ID!) {
    reopenTask(id: $id) {
      id
      status
      completedAt
    }
  }
`);

const ACCEPT_PROPOSED = gql(`
  mutation AcceptProposedTask($id: ID!) {
    acceptProposedTask(id: $id) {
      id
      status
    }
  }
`);

const DECLINE_PROPOSED = gql(`
  mutation DeclineProposedTask($id: ID!) {
    declineProposedTask(id: $id) {
      id
      status
    }
  }
`);

const ACCEPT_PENDING = gql(`
  mutation AcceptTaskPendingChange($id: ID!) {
    acceptTaskPendingChange(id: $id) {
      success
      task {
        id
        status
        title
        notes
        parentId
      }
    }
  }
`);

const DECLINE_PENDING = gql(`
  mutation DeclineTaskPendingChange($id: ID!) {
    declineTaskPendingChange(id: $id) {
      success
    }
  }
`);

const SCHEDULE_TASK = gql(`
  mutation ScheduleTask($id: ID!) {
    scheduleTask(id: $id) {
      success
      status
      task {
        id
        scheduledFor
        estimatedMinutes
      }
    }
  }
`);

export function PlanPage() {
  usePageTitle('Plan - Companion Intelligence');
  const { isFeatureEnabled } = useFeatures();
  const showEmptyState = isFeatureEnabled('planning.emptyState');

  const { data, loading, refetch } = useQuery(GET_TASKS, {
    variables: { first: 200 },
    // No subscriptions exist in this app, so a background refresh on revisit is
    // the closest thing to live data.
    fetchPolicy: 'cache-and-network',
  });

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const { data: dayData, refetch: refetchDay } = useQuery(GET_PLAN_DAY, {
    variables: { from: dayStart.toISOString(), to: dayEnd.toISOString() },
    fetchPolicy: 'cache-and-network',
  });

  const [completeTask] = useMutation(COMPLETE_TASK);
  const [reopenTask] = useMutation(REOPEN_TASK);
  const [acceptProposed] = useMutation(ACCEPT_PROPOSED);
  const [declineProposed] = useMutation(DECLINE_PROPOSED);
  const [acceptPending] = useMutation(ACCEPT_PENDING);
  const [declinePending] = useMutation(DECLINE_PENDING);
  const [scheduleTask] = useMutation(SCHEDULE_TASK);
  const [focusedTask, setFocusedTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<EditableTask | null>(null);
  const [editingEvent, setEditingEvent] = useState<DayEvent | null>(null);

  const pendingByTask = useMemo(() => {
    const map = new Map<string, { id: string; rationale: string | null; kind: string }>();

    for (const change of data?.taskPendingChanges ?? []) {
      if (!map.has(change.taskId)) {
        map.set(change.taskId, {
          id: change.id,
          rationale: change.rationale ?? null,
          kind: change.kind,
        });
      }
    }

    return map;
  }, [data]);

  const nodes = useMemo(() => {
    const edges = data?.tasks.edges.map((edge) => edge.node) ?? [];

    return edges.map((node) => ({
      ...node,
      hasPendingChange: pendingByTask.has(node.id),
    }));
  }, [data, pendingByTask]);

  // "Today" is the viewer's local day, not the server's. Recomputed per render
  // rather than memoised on [] so an open tab rolls over at local midnight.
  const sections = useMemo(
    () => groupIntoSections(nodes as unknown as SectionedTask[], localDateOf(new Date())),
    [nodes],
  );

  const handleToggle = (id: string, done: boolean) => {
    void (done ? completeTask({ variables: { id } }) : reopenTask({ variables: { id } }));
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    setFocusedTask(id);
  };

  const handleEdit = (e: React.MouseEvent, task: EditableTask) => {
    e.preventDefault();
    e.stopPropagation();

    setEditingTask(task);
  };

  const refresh = () => {
    void refetch();
    void refetchDay();
  };

  const handleSchedule = (id: string) => void scheduleTask({ variables: { id } }).then(refresh);

  const handleAcceptAndSchedule = (id: string) => {
    void acceptProposed({ variables: { id } }).then(() => scheduleTask({ variables: { id } }).then(refresh));
  };

  const renderTree = (task: SectionedTask, depth: number): ReactNode => {
    const pending = pendingByTask.get(task.id);
    const kids = childrenOf(nodes as unknown as SectionedTask[], task.id);

    return (
      <Task
        key={task.id}
        task={task as never}
        depth={depth}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onAcceptProposed={(id) => void acceptProposed({ variables: { id } }).then(refresh)}
        onDeclineProposed={(id) => void declineProposed({ variables: { id } }).then(refresh)}
        onAcceptAndSchedule={handleAcceptAndSchedule}
        onSchedule={handleSchedule}
        pendingChangeId={pending?.id}
        pendingRationale={pending?.rationale}
        pendingKind={pending?.kind}
        onAcceptPending={(changeId) => void acceptPending({ variables: { id: changeId } }).then(refresh)}
        onDeclinePending={(changeId) => void declinePending({ variables: { id: changeId } }).then(refresh)}
      >
        {kids.map((child) => renderTree(child, depth + 1))}
      </Task>
    );
  };

  let content: ReactNode;

  // `cache-and-network` re-reports loading on every revisit, so only show the
  // spinner when there is genuinely nothing to render yet.
  if (loading && nodes.length === 0) {
    content = <LoadingPage />;
  } else if (nodes.length === 0) {
    content = showEmptyState ? (
      <EmptyState
        icon={<ListTodo size={48} />}
        message={<div>Nothing planned yet. Add your first task above.</div>}
      />
    ) : null;
  } else {
    content = (
      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section key={section.key} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
              <span className="ml-2 font-normal">{section.tasks.length}</span>
            </h2>

            <ul className="flex flex-col gap-2">{section.tasks.map((task) => renderTree(task, 0))}</ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <>
      <PageContent>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <NewTaskForm onCreated={() => void refetch()} />

          <DaySchedule events={dayData?.eventsInRange ?? []} onEdit={setEditingEvent} />

          {/* `relative` scopes the loading and empty states, both of which
              position themselves `absolute inset-0`. Without a positioned
              parent here they fill the whole column and sit on top of the form,
              swallowing clicks on Add. */}
          <div className="relative min-h-60 flex-1">{content}</div>
        </div>
      </PageContent>

      {focusedTask && <DeleteTaskModal taskId={focusedTask} onClose={() => setFocusedTask(null)} />}
      {editingTask && (
        <EditTaskModal task={editingTask} onClose={() => setEditingTask(null)} onSaved={refresh} />
      )}
      {editingEvent && (
        <EditEventModal event={editingEvent} onClose={() => setEditingEvent(null)} onSaved={refresh} />
      )}
    </>
  );
}
