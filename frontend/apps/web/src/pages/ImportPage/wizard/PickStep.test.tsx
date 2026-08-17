import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogSource } from '../useImportApi';

import { PickStep } from './PickStep';

// The usage rollup reaches the import API through auth context, which the bare
// render here does not provide — the documented pattern is to stub the hook.
const usage = vi.hoisted(() => ({ value: new Map<string, { records: number; lastImportedAt: string }>() }));

vi.mock('./useSourceUsage', () => ({ useSourceUsage: () => usage.value }));

/**
 * Step 1's contract: recognizable brands in sections, each tile saying what
 * picking it imports, coming-soon visible-but-badged, and Continue earned by
 * picking something.
 */

function catalogSource(overrides: Partial<CatalogSource> & { id: string }): CatalogSource {
  return {
    title: overrides.id,
    blurb: '',
    ecosystem: 'music',
    category: 'audio',
    acquisition: 'web-export',
    wait: 'minutes',
    steps: [],
    importer: overrides.id,
    importerReady: true,
    ...overrides,
  };
}

const CATALOG = [
  catalogSource({
    id: 'spotify',
    title: 'Spotify',
    whatImported: ['Your full listening history', 'Playlists you made and followed'],
  }),
  catalogSource({ id: 'deezer', title: 'Deezer', importerReady: false }),
  catalogSource({ id: 'strava', title: 'Strava', ecosystem: 'wearable', category: 'health' }),
];

function renderStep(picked: ReadonlySet<string> = new Set()) {
  const onToggle = vi.fn();
  const onContinue = vi.fn();

  render(<PickStep catalog={CATALOG} picked={picked} onToggle={onToggle} onContinue={onContinue} />);

  return { onToggle, onContinue };
}

describe('PickStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usage.value = new Map();
  });

  it('groups services into their sections', () => {
    renderStep();

    expect(screen.getByRole('heading', { name: /music/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /fitness/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Spotify/ })).toBeInTheDocument();
  });

  it('badges a coming-soon importer instead of hiding it', () => {
    renderStep();

    const deezer = screen.getByRole('button', { name: /deezer/i });

    expect(deezer).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  // The search box and the category chips were answers to a grid of ~100
  // one-line names with nothing to tell them apart. The tiles carry a logo, a
  // name and what each source imports now, and the list is already grouped
  // under the same headings the chips repeated — so both are gone and every
  // section is simply present.
  it('shows the whole catalogue with no filter chrome in front of it', () => {
    renderStep();

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /filter by category/i })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Spotify/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Strava/ })).toBeInTheDocument();
  });

  it('says what each source imports, not just its name', () => {
    renderStep();

    // Answering "what would picking this give me" on the tile is the whole
    // reason it is a card rather than a one-line label.
    expect(screen.getByRole('button', { name: /Spotify/ })).toHaveTextContent('Listening');
  });

  // "I could import this" and "I did, in March, and it brought 42,318
  // records" are different answers, and the second is the one that stops
  // someone re-importing an archive they already have.
  it('says what a source has already given the appliance', () => {
    usage.value = new Map([['spotify', { records: 42318, lastImportedAt: '2026-03-14T00:00:00.000Z' }]]);

    renderStep();

    const spotify = screen.getByRole('button', { name: /Spotify/ });

    expect(spotify).toHaveTextContent('42,318 records');
    expect(spotify).toHaveTextContent(/imported/);
    expect(screen.getByRole('button', { name: /Strava/ })).not.toHaveTextContent('records');
  });

  it('toggling reports the source key upward', () => {
    const { onToggle } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: /Spotify/ }));
    expect(onToggle).toHaveBeenCalledWith('spotify');
  });

  it('Continue is disabled until something is picked, and counts the picks', () => {
    renderStep();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('Continue reports the pick count and fires', () => {
    const { onContinue } = renderStep(new Set(['spotify', 'strava']));
    const button = screen.getByRole('button', { name: /continue.*2 selected/i });

    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalled();
  });
});
