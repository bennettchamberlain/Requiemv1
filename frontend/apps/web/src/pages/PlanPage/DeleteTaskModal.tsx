import { useState } from 'react';

import { isReference, useMutation, type Reference } from '@apollo/client';
import { Button, Dialog } from '@ci/shadcn';

import { gql } from '@/graphql';

interface Props {
  taskIds: string[];
  onClose: () => void;
}

const DELETE_TASK = gql(`
  mutation DeleteTask($input: DeleteByIdInput!) {
    deleteTask(input: $input) {
      success
      deletedId
    }
  }
`);

export function DeleteTaskModal({ taskIds, onClose }: Props) {
  const [deleteTask, { loading: deleting }] = useMutation(DELETE_TASK, {
    // There are no subscriptions in this app, so the cache is updated by hand
    // rather than waiting for a push. Same shape as DeleteNoteModal.
    update(cache, { data }) {
      const deletedTaskId = data?.deleteTask?.deletedId;

      if (!deletedTaskId) {
        return;
      }

      cache.modify({
        fields: {
          tasks(existingTasks: { edges: { node: Reference }[] } | Reference = { edges: [] }, { readField }) {
            if (isReference(existingTasks)) {
              return existingTasks;
            }

            return {
              ...existingTasks,
              edges: existingTasks.edges.filter((edge) => readField('id', edge.node) !== deletedTaskId),
            };
          },
        },
      });

      const normalizedId = cache.identify({ id: deletedTaskId, __typename: 'TaskType' });

      if (normalizedId) {
        cache.evict({ id: normalizedId });
        cache.gc();
      }
    },
  });

  const [error, setError] = useState<string | null>(null);
  const many = taskIds.length > 1;

  const handleDelete = async () => {
    setError(null);

    try {
      for (const id of taskIds) {
        await deleteTask({ variables: { input: { id } } });
      }
      onClose();
    } catch {
      // Leave the dialog open on failure — closing it here would read as a
      // successful delete even though the task is still there.
      setError(many ? 'Could not delete these tasks. Please try again.' : 'Could not delete this task. Please try again.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content className="sm:max-w-[425px]">
        <Dialog.Header>
          <Dialog.Title>{many ? `Delete ${taskIds.length} tasks` : 'Delete task'}</Dialog.Title>
          <Dialog.Description>
            {many
              ? `Are you sure you want to delete ${taskIds.length} tasks? This action cannot be undone.`
              : 'Are you sure you want to delete this task? This action cannot be undone.'}
          </Dialog.Description>
        </Dialog.Header>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
