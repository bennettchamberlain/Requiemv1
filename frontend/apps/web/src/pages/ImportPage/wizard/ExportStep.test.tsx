import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogSource } from '../useImportApi';

import { ExportStep } from './ExportStep';
import type { ExportEntry } from './sources';

/**
 * The export card's contract with the backend: an upload becomes one
 * unpack+parse run PER DROP — parse now, push at Sync — labeled so History can
 * say what it was.
 */

const uploadFiles = vi.fn(async () => [
  { dropId: 'drop-1', originalFilename: 'spotify.zip' },
  { dropId: 'drop-2', originalFilename: 'spotify-extended.zip' },
]);
const startRun = vi.fn(async (dropId: string) => ({ id: `run-${dropId}`, stages: [] }));

const API = {
  ready: true,
  uploadFiles,
  startRun,
};

vi.mock('../useImportApi', () => ({
  useImportApi: () => API,
}));

vi.mock('./LiveRun', () => ({
  LiveRun: ({ runId }: { runId: string }) => <div>pipeline for {runId}</div>,
}));

vi.mock('../DropZone', () => ({
  DropZone: ({ onFiles, label }: { onFiles: (files: File[]) => void; label?: string }) => (
    <button type="button" onClick={() => onFiles([new File(['x'], 'spotify.zip')])}>
      {label ?? 'drop'}
    </button>
  ),
}));

function catalogSource(overrides: Partial<CatalogSource> & { id: string }): CatalogSource {
  return {
    title: overrides.id,
    blurb: 'blurb',
    ecosystem: 'music',
    category: 'audio',
    acquisition: 'web-export',
    wait: 'days',
    steps: ['Ask for the export.', 'Upload it here.'],
    importer: overrides.id,
    importerReady: true,
    ...overrides,
  };
}

const SPOTIFY: ExportEntry = {
  kind: 'service',
  key: 'spotify',
  source: catalogSource({ id: 'spotify', title: 'Spotify' }),
};

const NOT_READY: ExportEntry = {
  kind: 'service',
  key: 'deezer',
  source: catalogSource({ id: 'deezer', title: 'Deezer', importerReady: false }),
};

function renderStep(overrides: Partial<Parameters<typeof ExportStep>[0]> = {}) {
  const onIndex = vi.fn();
  const onRunsStarted = vi.fn();
  const onFinish = vi.fn();

  render(
    <ExportStep
      entries={[SPOTIFY, NOT_READY]}
      index={0}
      runsByEntry={new Map()}
      onRunsStarted={onRunsStarted}
      onIndex={onIndex}
      onBackToPick={vi.fn()}
      onFinish={onFinish}
      {...overrides}
    />,
  );

  return { onIndex, onRunsStarted, onFinish };
}

describe('ExportStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows where in the walk this card sits', () => {
    renderStep();

    expect(screen.getByText(/Service 1 of 2/)).toBeInTheDocument();
  });

  it('badges how the export is obtained beside how long it takes', () => {
    renderStep();

    // The fixture is a days-wait web-export: both chips, human words.
    expect(screen.getByText('Takes a day or more')).toBeInTheDocument();
    expect(screen.getByText('Web export')).toBeInTheDocument();
  });

  it('renders the expected format and the notes, which most guides carry', () => {
    renderStep({
      entries: [
        {
          ...SPOTIFY,
          source: {
            ...SPOTIFY.source,
            expectedFormat: 'A zip containing StreamingHistory*.json files.',
            notes: ['The extended history arrives separately, weeks later.'],
          },
        },
      ],
    });

    expect(screen.getByRole('heading', { name: /expected format/i })).toBeInTheDocument();
    expect(screen.getByText(/StreamingHistory\*\.json/)).toBeInTheDocument();
    expect(screen.getByText(/extended history arrives separately/i)).toBeInTheDocument();
  });

  it('names the service in the export-page button, below the instructions', () => {
    renderStep({
      entries: [
        {
          ...SPOTIFY,
          source: { ...SPOTIFY.source, url: 'https://www.spotify.com/account/privacy/' },
        },
      ],
    });

    const cta = screen.getByRole('link', { name: /open the spotify export page/i });

    expect(cta).toHaveAttribute('href', 'https://www.spotify.com/account/privacy/');

    // Below the steps, as upstream places it: the instructions are read first,
    // the doorway is the last thing on the way out.
    const lastStep = screen.getByText('Upload it here.');

    expect(
       
      lastStep.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('starts one parse-only run per uploaded file, labeled by its filename', async () => {
    const { onRunsStarted } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: /drop your spotify export here/i }));

    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));

    // Parse now, push at Sync — the whole reason the wizard has a step 3.
    expect(startRun).toHaveBeenCalledWith('drop-1', {
      label: 'spotify.zip',
      stages: ['unpack', 'parse'],
    });
    expect(startRun).toHaveBeenCalledWith('drop-2', {
      label: 'spotify-extended.zip',
      stages: ['unpack', 'parse'],
    });
    expect(onRunsStarted).toHaveBeenCalledWith('spotify', ['run-drop-1', 'run-drop-2']);
  });

  it('renders the live pipeline for runs already started from this card', () => {
    renderStep({ runsByEntry: new Map([['spotify', ['run-a']]]) });

    expect(screen.getByText('pipeline for run-a')).toBeInTheDocument();
  });

  it('walks forward, and the last card hands off to Sync', () => {
    const { onIndex } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onIndex).toHaveBeenCalledWith(1);

    const { onFinish } = renderStep({ index: 1 });

    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(onFinish).toHaveBeenCalled();
  });

  it('offers no upload for a coming-soon importer, but keeps the instructions', () => {
    renderStep({ index: 1 });

    expect(screen.queryByRole('button', { name: /drop your deezer export/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not finished yet/i)).toBeInTheDocument();
    // The steps still render: exporting now and uploading later is legitimate.
    expect(screen.getByText('Ask for the export.')).toBeInTheDocument();
  });
});
