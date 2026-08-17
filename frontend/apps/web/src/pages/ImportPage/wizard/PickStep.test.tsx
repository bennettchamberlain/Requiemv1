import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogSource } from '../useImportApi';

import { PickStep } from './PickStep';

// The usage rollup reaches the import API through auth context, which the bare
// render here does not provide — the documented pattern is to stub the hook.
// `unambiguousImporters` is a pure derivation over the catalog and stays real.
const usage = vi.hoisted(() => ({ value: new Map<string, string>() }));

vi.mock('./useSourceUsage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useSourceUsage')>();

  return { ...actual, useSourceUsage: () => usage.value };
});

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

  it('renders every kind on a tile that has more than four, none dropped', () => {
    const onToggle = vi.fn();
    const onContinue = vi.fn();

    // The Amazon bundle's five members span four categories — five kinds in
    // all, which the tile lays out in two columns rather than truncating.
    render(
      <PickStep
        catalog={[
          catalogSource({ id: 'amazon', title: 'Amazon orders', ecosystem: 'amazon', category: 'finance' }),
          catalogSource({ id: 'prime_video', title: 'Prime Video', ecosystem: 'amazon', category: 'video' }),
          catalogSource({ id: 'audible', title: 'Audible', ecosystem: 'amazon', category: 'audio' }),
          catalogSource({
            id: 'kindle_reading',
            title: 'Kindle reading',
            ecosystem: 'amazon',
            category: 'reading',
          }),
          catalogSource({ id: 'amazon_music', title: 'Amazon Music', ecosystem: 'amazon', category: 'audio' }),
        ]}
        picked={new Set()}
        onToggle={onToggle}
        onContinue={onContinue}
      />,
    );

    const amazon = screen.getByRole('button', { name: /Amazon/ });

    for (const kind of ['Orders & payments', 'Watch history', 'Listening', 'Playlists', 'Books & highlights']) {
      expect(amazon).toHaveTextContent(kind);
    }
  });

  // "I could import this" and "I already did, in March" are different
  // answers, and the second is what stops someone re-importing an archive
  // they already have. How MUCH it brought is a fact about the run, not about
  // the source, so it is not claimed here.
  it('says when a source was last imported', () => {
    usage.value = new Map([['spotify', '2026-03-14T00:00:00.000Z']]);

    renderStep();

    expect(screen.getByRole('button', { name: /Spotify/ })).toHaveTextContent(/imported/);
    expect(screen.getByRole('button', { name: /Strava/ })).not.toHaveTextContent(/imported/);
  });

  // A run records which IMPORTER it fed, and thirteen catalog sources share
  // four parsers. Crediting Apple Calendar because a Google Calendar was
  // imported is a claim about the wrong service.
  it('claims nothing for a source whose parser is shared with another', () => {
    usage.value = new Map([['calendar', '2026-03-14T00:00:00.000Z']]);

    render(
      <PickStep
        catalog={[
          catalogSource({ id: 'google_calendar', title: 'Google Calendar', importer: 'calendar' }),
          catalogSource({ id: 'apple_calendar', title: 'Apple Calendar', importer: 'calendar' }),
        ]}
        picked={new Set()}
        onToggle={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Google Calendar/ })).not.toHaveTextContent(/imported/);
    expect(screen.getByRole('button', { name: /Apple Calendar/ })).not.toHaveTextContent(/imported/);
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
