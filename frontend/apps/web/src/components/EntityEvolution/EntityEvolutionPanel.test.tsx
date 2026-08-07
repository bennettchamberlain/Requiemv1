import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EvolutionDelta } from '@/api/useEntityEvolutionService';

import { EntityEvolutionPanel } from './EntityEvolutionPanel';

const FOCUS_ID = '019fdcb3-b482-7101-af89-264466bf95ff';

const useEntityEvolutionService = vi.fn();

vi.mock('@/api/useEntityEvolutionService', () => ({
  useEntityEvolutionService: (props: unknown) => useEntityEvolutionService(props),
}));

function delta(overrides: Partial<EvolutionDelta> = {}): EvolutionDelta {
  return {
    deltaId: 'delta-1',
    nodeType: 'entity',
    entityId: FOCUS_ID,
    relationshipId: null,
    entityType: 'person',
    relationshipType: null,
    changeType: 'created',
    changedFields: {},
    fieldChanges: [],
    changeSource: null,
    changeReason: null,
    summaryId: null,
    changedAt: '2026-08-07T19:49:00.000Z',
    entity: { entityId: FOCUS_ID, entityType: 'person', name: 'Abdul Ameer' },
    fromEntity: null,
    toEntity: null,
    ...overrides,
  };
}

function mockDeltas(deltas: EvolutionDelta[]) {
  useEntityEvolutionService.mockReturnValue({
    data: {
      entityId: FOCUS_ID,
      deltas,
      stats: {
        total: deltas.length,
        firstChangedAt: null,
        lastChangedAt: null,
        created: 0,
        updated: 0,
        archived: 0,
        deleted: 0,
        merged: 0,
        entity: 0,
        relationship: 0,
      },
    },
    loading: false,
    error: null,
  });
}

/** The two records the reported screenshot showed: a LinkedIn import creating a person and a link. */
const IMPORT_DELTAS = [
  delta({
    deltaId: 'rel-1',
    nodeType: 'relationship',
    relationshipId: 'rel-1',
    relationshipType: 'KNOWS',
    fromEntity: { entityId: FOCUS_ID, entityType: 'person', name: 'Abdul Ameer' },
    toEntity: { entityId: 'user-1', entityType: 'person', name: 'Hanzla Mateen' },
  }),
  delta({
    deltaId: 'ent-1',
    fieldChanges: [
      { field: 'name', oldValue: null, newValue: 'Abdul Ameer' },
      { field: 'properties', oldValue: null, newValue: { URL: 'https://linkedin.com/in/x', Source: 'li' } },
      { field: 'description', oldValue: null, newValue: null },
    ],
  }),
];

describe('EntityEvolutionPanel', () => {
  it('says what the panel is, in words', () => {
    mockDeltas(IMPORT_DELTAS);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} entityName="Abdul Ameer" />);

    expect(screen.getByRole('heading', { name: 'Change History' })).toBeInTheDocument();
    expect(
      screen.getByText(/Every recorded change to Abdul Ameer and its relationships/),
    ).toBeInTheDocument();
  });

  it('counts only the change types that occurred', () => {
    mockDeltas(IMPORT_DELTAS);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    expect(screen.getByText('Created 2')).toBeInTheDocument();
    // "Updated 0 / Deleted 0" was the panel's most prominent content, saying nothing.
    expect(screen.queryByText(/Updated 0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deleted 0/)).not.toBeInTheDocument();
  });

  it('keeps the filter chips out of the way of a short history', () => {
    mockDeltas(IMPORT_DELTAS);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    expect(screen.queryByRole('button', { name: /Filters/ })).not.toBeInTheDocument();
    expect(screen.queryByText('All Time')).not.toBeInTheDocument();
  });

  it('offers filters once there is enough history to need them', () => {
    mockDeltas([
      delta({ deltaId: 'a' }),
      delta({ deltaId: 'b' }),
      delta({ deltaId: 'c' }),
      delta({ deltaId: 'd' }),
    ]);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    expect(screen.getByRole('button', { name: /Filters/ })).toBeInTheDocument();
    // Still collapsed until asked for.
    expect(screen.queryByText('All Time')).not.toBeInTheDocument();
  });

  it('reads a creation as a birth rather than a diff from nothing', () => {
    mockDeltas(IMPORT_DELTAS);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    expect(screen.getByText(/Added to your graph as Abdul Ameer/)).toBeInTheDocument();
    // "Name: empty -> Abdul Ameer" reads as a defect.
    expect(screen.queryByText(/empty ->/)).not.toBeInTheDocument();
  });

  it('drops field rows whose two sides are identical', () => {
    mockDeltas(IMPORT_DELTAS);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    // 'Description: empty -> empty' was rendered verbatim.
    expect(screen.queryByText(/Description:/)).not.toBeInTheDocument();
    expect(screen.getByText(/Name:/)).toBeInTheDocument();
  });

  it('summarises an object by its keys instead of truncated JSON', () => {
    mockDeltas(IMPORT_DELTAS);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    expect(screen.getByText(/2 fields: URL, Source/)).toBeInTheDocument();
    expect(screen.queryByText(/\{"URL"/)).not.toBeInTheDocument();
  });

  it('names the other end of a changed relationship', () => {
    mockDeltas(IMPORT_DELTAS);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    expect(screen.getByText('New link to Hanzla Mateen')).toBeInTheDocument();
  });

  it('drops the provenance tiles when there is no provenance', () => {
    mockDeltas(IMPORT_DELTAS);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    // Three tiles, two of them an em dash and the third repeating the header's timestamp.
    expect(screen.queryByText('Change Reason')).not.toBeInTheDocument();
    expect(screen.queryByText('Change Source')).not.toBeInTheDocument();
    expect(screen.queryByText('Changed At')).not.toBeInTheDocument();
  });

  it('shows provenance when the record carries any', () => {
    mockDeltas([delta({ changeSource: 'linkedin_import', changeReason: 'Initial sync' })]);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    expect(screen.getByText('Source: Linkedin Import')).toBeInTheDocument();
    expect(screen.getByText('Reason: Initial sync')).toBeInTheDocument();
  });

  it('explains an empty history rather than blaming the filters', () => {
    mockDeltas([]);

    render(<EntityEvolutionPanel entityId={FOCUS_ID} />);

    expect(screen.getByText(/No changes recorded yet/)).toBeInTheDocument();
  });
});
