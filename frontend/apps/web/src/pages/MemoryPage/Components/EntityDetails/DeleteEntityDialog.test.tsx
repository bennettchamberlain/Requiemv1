import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { mockQuery } from '@/test/gql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { DeleteEntityDialog } from './DeleteEntityDialog';
import { DELETE_TARGETS, RESTORE_EVENT } from './deleteTargets';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@ci/shadcn', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    useToast: () => ({ toast: { success: toastSuccess, error: toastError } }),
  };
});

const EVENT_GID = 'ZXZlbnQ6ZTE=';
const PERSON_GID = 'cGVyc29uOnAx';

describe('DeleteEntityDialog', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('promises an undo for a soft-deleted event, and offers it once deleted', async () => {
    const onDeleted = vi.fn();

    renderWithProviders(
      <DeleteEntityDialog
        target={DELETE_TARGETS.event}
        entityId={EVENT_GID}
        typename="EventType"
        title="Dinner with Sam"
        onClose={vi.fn()}
        onDeleted={onDeleted}
        onRestored={vi.fn()}
      />,
      {
        mocks: [
          mockQuery(
            DELETE_TARGETS.event.document,
            { input: { id: EVENT_GID } },
            { deleteEvent: { success: true, deletedId: EVENT_GID } },
          ),
        ],
      },
    );

    expect(screen.getByText('Delete event?')).toBeInTheDocument();
    // The copy must not claim permanence for a delete that is reversible.
    expect(screen.getByText(/You can undo this/)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(
      'Deleted “Dinner with Sam”.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
    );
  });

  it('says a hard delete cannot be undone and offers no undo action', async () => {
    const onDeleted = vi.fn();

    renderWithProviders(
      <DeleteEntityDialog
        target={DELETE_TARGETS.person}
        entityId={PERSON_GID}
        typename="PersonType"
        title="Missed call from"
        onClose={vi.fn()}
        onDeleted={onDeleted}
        onRestored={vi.fn()}
      />,
      {
        mocks: [
          mockQuery(
            DELETE_TARGETS.person.document,
            { input: { id: PERSON_GID } },
            { deletePerson: { success: true, deletedId: PERSON_GID } },
          ),
        ],
      },
    );

    expect(screen.getByText('Delete person?')).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Deleted “Missed call from”.', undefined);
  });

  it('keeps the dialog open and explains itself when the delete fails', async () => {
    const onDeleted = vi.fn();

    renderWithProviders(
      <DeleteEntityDialog
        target={DELETE_TARGETS.person}
        entityId={PERSON_GID}
        typename="PersonType"
        title="Missed call from"
        onClose={vi.fn()}
        onDeleted={onDeleted}
        onRestored={vi.fn()}
      />,
      {
        mocks: [
          mockQuery(DELETE_TARGETS.person.document, { input: { id: PERSON_GID } }, { deletePerson: null }),
        ],
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Could not delete this person.');
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('restores the event when the undo action is taken', async () => {
    const onRestored = vi.fn();

    renderWithProviders(
      <DeleteEntityDialog
        target={DELETE_TARGETS.event}
        entityId={EVENT_GID}
        typename="EventType"
        title="Dinner with Sam"
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onRestored={onRestored}
      />,
      {
        mocks: [
          mockQuery(
            DELETE_TARGETS.event.document,
            { input: { id: EVENT_GID } },
            { deleteEvent: { success: true, deletedId: EVENT_GID } },
          ),
          mockQuery(
            RESTORE_EVENT,
            { input: { id: EVENT_GID } },
            { restoreEvent: { __typename: 'EventType', id: EVENT_GID } },
          ),
        ],
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    const options = toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } };

    await act(async () => {
      options.action.onClick();
    });

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});
