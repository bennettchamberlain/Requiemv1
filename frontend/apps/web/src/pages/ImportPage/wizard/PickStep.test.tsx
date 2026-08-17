import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogSource } from '../useImportApi';

import { PickStep } from './PickStep';

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
  beforeEach(() => vi.clearAllMocks());

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
