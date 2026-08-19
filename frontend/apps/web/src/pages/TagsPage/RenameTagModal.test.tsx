import { type ComponentProps } from 'react';

import { type MockedResponse } from '@apollo/client/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gql } from '@/graphql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { RenameTagModal } from './RenameTagModal';
import { type TagListItem } from './tagList';

const UPDATE_TAG = gql(`
  mutation UpdateTag($input: UpdateTagInput!) {
    updateTag(input: $input) {
      success
      merged
      movedEntityCount
      updatedSavedSearchCount
      tag {
        id
        label
        description
        entityCount
      }
    }
  }
`);

const holiday: TagListItem = { id: 't1', label: 'holiday', description: null, entityCount: 3 };
const vacation: TagListItem = { id: 't2', label: 'vacation', description: 'time off', entityCount: 7 };

function updateMock(
  input: { id: string; label: string; description: string | null },
  overrides: { merged?: boolean; movedEntityCount?: number; label?: string } = {},
) {
  const { merged = false, movedEntityCount = 0, label = input.label } = overrides;

  return {
    request: { query: UPDATE_TAG, variables: { input } },
    result: {
      data: {
        updateTag: {
          __typename: 'UpdateTagPayload',
          success: true,
          merged,
          movedEntityCount,
          updatedSavedSearchCount: 0,
          tag: {
            __typename: 'TagType',
            id: merged ? 't2' : input.id,
            label,
            description: input.description,
            entityCount: 3,
          },
        },
      },
    },
  };
}

function renderModal(
  props: Partial<ComponentProps<typeof RenameTagModal>> = {},
  mocks: readonly MockedResponse[] = [],
) {
  const onClose = props.onClose ?? vi.fn();
  const onRenamed = props.onRenamed ?? vi.fn();

  renderWithProviders(
    <RenameTagModal
      tag={props.tag ?? holiday}
      tags={props.tags ?? [holiday, vacation]}
      onClose={onClose}
      onRenamed={onRenamed}
    />,
    { mocks },
  );

  return { onClose, onRenamed };
}

describe('RenameTagModal', () => {
  it('sends the normalised label, not what was typed', async () => {
    const { onRenamed } = renderModal({}, [
      updateMock({ id: 't1', label: 'summer trip', description: null }),
    ]);

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '  Summer Trip  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // An unmatched mock would fail here — reaching onRenamed proves the
    // lower-cased, trimmed label is what actually went over the wire.
    await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(1));
  });

  it('warns that the label is only stored lower case', () => {
    renderModal({}, []);

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Summer' } });

    expect(screen.getByText(/saves as .summer./i)).toBeInTheDocument();
  });

  it('warns before a rename that would silently merge two tags', () => {
    renderModal({}, []);

    expect(screen.queryByText(/will merge the two/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'vacation' } });

    expect(screen.getByText(/already have a .vacation. tag/i)).toBeInTheDocument();
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
    // The action itself changes to say what it really does.
    expect(screen.getByRole('button', { name: /merge tags/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });

  it('treats a rename that only changes case as no change at all', () => {
    renderModal({}, []);

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'HOLIDAY' } });

    expect(screen.queryByText(/saves as/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('refuses to save an empty label', () => {
    renderModal({}, []);

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('clears the description rather than storing an empty string', async () => {
    const { onRenamed } = renderModal({ tag: { ...holiday, description: 'old note' } }, [
      updateMock({ id: 't1', label: 'holiday', description: null }),
    ]);

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(1));
  });

  it('keeps the dialog open and explains itself when the save fails', async () => {
    const { onClose, onRenamed } = renderModal({}, [
      {
        request: {
          query: UPDATE_TAG,
          variables: { input: { id: 't1', label: 'holiday', description: null } },
        },
        error: new Error('network down'),
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/could not update this tag/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onRenamed).not.toHaveBeenCalled();
  });
});
