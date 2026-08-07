import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EntityTagsDescriptionCard } from './EntityTagsDescriptionCard';

const tagEntities = vi.fn().mockResolvedValue(undefined);
const untagEntities = vi.fn().mockResolvedValue(undefined);
const toastError = vi.fn();

vi.mock('@/api', () => ({
  useTagEntityService: () => ({ tagEntities, untagEntities }),
}));

vi.mock('@ci/shadcn', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return { ...actual, useToast: () => ({ toast: { error: toastError, success: vi.fn() } }) };
});

const BASE = {
  entityType: 'person' as const,
  entityId: '019fdcb3-b482-7101-af89-264466bf95ff',
  resetKey: 'person-1',
};

describe('EntityTagsDescriptionCard', () => {
  it('says so when there is nothing recorded, instead of showing empty inputs', () => {
    render(<EntityTagsDescriptionCard {...BASE} tags={[]} description={null} editMode={false} />);

    expect(screen.getByText('No tags yet')).toBeInTheDocument();
    expect(screen.getByText('No description yet')).toBeInTheDocument();
    // The bare editor chrome is what read as broken; in read mode it should not be there at all.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('names the placeholder after the field, which is not always "description"', () => {
    render(
      <EntityTagsDescriptionCard
        {...BASE}
        tags={[]}
        description=""
        descriptionLabel="Summary"
        editMode={false}
      />,
    );

    expect(screen.getByText('No summary yet')).toBeInTheDocument();
  });

  it('shows the real values when there are any', () => {
    render(
      <EntityTagsDescriptionCard
        {...BASE}
        tags={['colleague']}
        description="Met at the conference."
        editMode={false}
      />,
    );

    expect(screen.queryByText('No tags yet')).not.toBeInTheDocument();
    expect(screen.getByText('colleague')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Met at the conference.')).toBeInTheDocument();
  });

  it('offers the editors in edit mode even when empty', () => {
    render(
      <EntityTagsDescriptionCard
        {...BASE}
        tags={[]}
        description={null}
        editMode
        onDescriptionSave={vi.fn()}
      />,
    );

    expect(screen.queryByText('No tags yet')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Add a description…')).toBeInTheDocument();
  });

  it('persists an edited description on blur', async () => {
    const onDescriptionSave = vi.fn().mockResolvedValue(undefined);

    render(
      <EntityTagsDescriptionCard
        {...BASE}
        tags={[]}
        description="Before"
        editMode
        onDescriptionSave={onDescriptionSave}
      />,
    );

    const textarea = screen.getByDisplayValue('Before');
    fireEvent.change(textarea, { target: { value: 'After' } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(onDescriptionSave).toHaveBeenCalledWith('After');
    });
  });

  it('does not write when the text came back unchanged', () => {
    const onDescriptionSave = vi.fn().mockResolvedValue(undefined);

    render(
      <EntityTagsDescriptionCard
        {...BASE}
        tags={[]}
        description="Before"
        editMode
        onDescriptionSave={onDescriptionSave}
      />,
    );

    const textarea = screen.getByDisplayValue('Before');
    fireEvent.change(textarea, { target: { value: 'Changed' } });
    fireEvent.change(textarea, { target: { value: 'Before' } });
    fireEvent.blur(textarea);

    expect(onDescriptionSave).not.toHaveBeenCalled();
  });

  it('restores the previous text and reports a failed save', async () => {
    const onDescriptionSave = vi.fn().mockRejectedValue(new Error('rejected'));

    render(
      <EntityTagsDescriptionCard
        {...BASE}
        tags={[]}
        description="Before"
        editMode
        onDescriptionSave={onDescriptionSave}
      />,
    );

    const textarea = screen.getByDisplayValue('Before');
    fireEvent.change(textarea, { target: { value: 'After' } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
      expect(screen.getByDisplayValue('Before')).toBeInTheDocument();
    });
  });

  it('keeps the field read-only when the entity type has no write path', () => {
    render(
      <EntityTagsDescriptionCard
        {...BASE}
        tags={[]}
        description="Preview text"
        descriptionLabel="Summary"
        editMode
      />,
    );

    // Editable-looking chrome that silently discards edits is the defect, not the fix.
    expect(screen.getByDisplayValue('Preview text')).toHaveAttribute('readonly');
  });

  it('renders type-specific detail above the tags', () => {
    render(
      <EntityTagsDescriptionCard {...BASE} tags={[]} description={null} editMode={false}>
        <div>Organizer: Hanzla Mateen</div>
      </EntityTagsDescriptionCard>,
    );

    expect(screen.getByText('Organizer: Hanzla Mateen')).toBeInTheDocument();
  });
});
