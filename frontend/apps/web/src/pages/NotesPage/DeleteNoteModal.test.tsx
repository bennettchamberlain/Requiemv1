import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { mockQuery } from '@/test/gql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { DELETE_NOTE, DeleteNoteModal } from './DeleteNoteModal';

const NOTE_ID = 'note-1';

describe('DeleteNoteModal', () => {
  it('deletes the note and closes on success', async () => {
    const onClose = vi.fn();

    const deleted = mockQuery(
      DELETE_NOTE,
      { input: { id: NOTE_ID } },
      {
        deleteNote: {
          __typename: 'DeleteByIdPayload',
          success: true,
          deletedId: NOTE_ID,
        },
      },
    );

    renderWithProviders(<DeleteNoteModal noteId={NOTE_ID} onClose={onClose} />, {
      mocks: [deleted],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText('Could not delete this note. Please try again.')).not.toBeInTheDocument();
  });

  it('surfaces an error and keeps the dialog open on failure', async () => {
    const onClose = vi.fn();

    // No matching mock, so the mutation rejects — same as a network/GraphQL error.
    renderWithProviders(<DeleteNoteModal noteId={NOTE_ID} onClose={onClose} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(screen.getByText('Could not delete this note. Please try again.')).toBeInTheDocument(),
    );

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled();
  });
});
