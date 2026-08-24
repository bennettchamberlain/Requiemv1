import { useState, type ReactNode } from 'react';

import { useMutation } from '@apollo/client';
import { EmptyState, LoadingPage, usePageTitle } from '@ci/common';
import { ListTodo } from '@ci/shadcn/icons';

import { useFeatures } from '@/common/feature';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

import { DeleteTaskModal } from './DeleteTaskModal';
import { EditTaskModal, UPDATE_TASK, type EditableTask } from './EditTaskModal';
import { NewTaskForm } from './NewTaskForm';
import { Task } from './Task';
import { TaskBoard } from './TaskBoard';
import { childrenOf, dueAtFromLocalDate, type SectionedTask } from './taskSections';
import { ACCEPT_PROPOSED, DECLINE_PROPOSED, SCHEDULE_TASK, usePlanTasks } from './usePlanTasks';

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

export function PlanPage() {
  usePageTitle('Plan - Companion Intelligence');
  const { isFeatureEnabled } = useFeatures();
  const showEmptyState = isFeatureEnabled('planning.emptyState');

  const { nodes, sections, pendingByTask, loading, refetch } = usePlanTasks();

  const [completeTask] = useMutation(COMPLETE_TASK);
  const [reopenTask] = useMutation(REOPEN_TASK);
  const [acceptProposed] = useMutation(ACCEPT_PROPOSED);
  const [declineProposed] = useMutation(DECLINE_PROPOSED);
  const [acceptPending] = useMutation(ACCEPT_PENDING);
  const [declinePending] = useMutation(DECLINE_PENDING);
  const [scheduleTask] = useMutation(SCHEDULE_TASK);
  const [updateTask] = useMutation(UPDATE_TASK);
  const [focusedTask, setFocusedTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<EditableTask | null>(null);

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
  };

  const handleSchedule = (id: string) => void scheduleTask({ variables: { id } }).then(refresh);

  const handleReschedule = (id: string, date: string) => {
    void (async () => {
      await updateTask({
        variables: {
          input: { id, dueAt: dueAtFromLocalDate(date) },
        },
      });
      await scheduleTask({ variables: { id, date } });
      refresh();
    })();
  };

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
        onReschedule={handleReschedule}
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
    content = <TaskBoard sections={sections} renderTask={(task) => renderTree(task, 0)} />;
  }

  return (
    <>
      <PageContent>
        <div className="flex h-full min-h-0 w-full flex-col gap-6">
          <div className="mx-auto w-full max-w-3xl shrink-0">
            <NewTaskForm onCreated={() => void refetch()} />
          </div>

          {/* `relative` scopes the loading and empty states, both of which
              position themselves `absolute inset-0`. Without a positioned
              parent here they fill the whole column and sit on top of the form,
              swallowing clicks on Add. `min-h-0` lets the board fill leftover
              height so each column scrolls instead of the whole page. */}
          <div className="relative flex min-h-0 flex-1 flex-col">{content}</div>
        </div>
      </PageContent>

      {focusedTask && <DeleteTaskModal taskId={focusedTask} onClose={() => setFocusedTask(null)} />}
      {editingTask && (
        <EditTaskModal task={editingTask} onClose={() => setEditingTask(null)} onSaved={refresh} />
      )}
    </>
  );
}
