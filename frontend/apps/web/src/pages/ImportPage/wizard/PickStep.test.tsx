import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogSource } from '../useImportApi';

import { PickStep } from './PickStep';

/**
 * Step 1's contract: recognizable brands in sections, search and facets narrow
 * without losing anyone, coming-soon is visible-but-badged, and Continue is
 * earned by picking something.
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
  catalogSource({ id: 'spotify', title: 'Spotify' }),
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
    expect(screen.getByRole('button', { name: 'Spotify' })).toBeInTheDocument();
  });

  it('badges a coming-soon importer instead of hiding it', () => {
    renderStep();

    const deezer = screen.getByRole('button', { name: /deezer/i });

    expect(deezer).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('search narrows the grid', () => {
    renderStep();

    fireEvent.change(screen.getByRole('searchbox', { name: /search services/i }), {
      target: { value: 'strav' },
    });

    expect(screen.getByRole('button', { name: 'Strava' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Spotify' })).not.toBeInTheDocument();
  });

  it('a facet chip narrows to one section, and clicking it again clears', () => {
    renderStep();

    fireEvent.click(screen.getByRole('button', { name: /^music$/i }));
    expect(screen.queryByRole('button', { name: 'Strava' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^music$/i }));
    expect(screen.getByRole('button', { name: 'Strava' })).toBeInTheDocument();
  });

  it('toggling reports the source key upward', () => {
    const { onToggle } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: 'Spotify' }));
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
