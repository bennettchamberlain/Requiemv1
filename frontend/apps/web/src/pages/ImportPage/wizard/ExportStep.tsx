import { useState } from 'react';

import { Badge, Button } from '@ci/shadcn';

import { DropZone } from '../DropZone';
import { SourceGuide } from '../SourceGuide';
import { useImportApi } from '../useImportApi';

import { LiveRun } from './LiveRun';
import { bundleToGuide, serviceLogoUrl, shortTitle, sourceToGuide, type ExportEntry } from './sources';

export interface ExportStepProps {
  entries: readonly ExportEntry[];
  index: number;
  /** Run ids already started per entry key, so revisiting a card keeps its pipelines. */
  runsByEntry: ReadonlyMap<string, readonly string[]>;
  onRunsStarted: (entryKey: string, runIds: readonly string[]) => void;
  onIndex: (index: number) => void;
  onBackToPick: () => void;
  onFinish: () => void;
}

/**
 * Step 2: one card per picked service, walked in order.
 *
 * The card is the authored export instructions with the upload INSIDE them —
 * the steps end at "upload it here", and here is where that is. An upload
 * starts an unpack+parse run immediately (one run per file: a drop is one
 * archive), so extraction happens while the person works through their other
 * services; the final Sync step only pushes. The live pipeline renders on the
 * card, and its parse counts are the "your drop landed" feedback.
 */
export function ExportStep({
  entries,
  index,
  runsByEntry,
  onRunsStarted,
  onIndex,
  onBackToPick,
  onFinish,
}: ExportStepProps) {
  const api = useImportApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">No services selected yet.</p>
        <Button onClick={onBackToPick}>← Pick services</Button>
      </div>
    );
  }

  const clamped = Math.min(index, entries.length - 1);
  const entry = entries[clamped];
  const guide = entry.kind === 'bundle' ? bundleToGuide(entry.bundle) : sourceToGuide(entry.source);
  const startedRuns = runsByEntry.get(entry.key) ?? [];
  const notReady = entry.kind === 'service' && !entry.source.importerReady;

  async function handleFiles(files: File[]) {
    setBusy(true);
    setError(null);

    try {
      const drops = await api.uploadFiles(files);

      if (drops.length === 0) {
        throw new Error('Nothing was uploaded');
      }

      // One run per drop: a drop is one archive. Parse-only — the push is the
      // Sync step's, over everything at once.
      const runIds: string[] = [];

      for (const drop of drops) {
        const run = await api.startRun(drop.dropId, {
          label: drop.originalFilename ?? shortTitle(guide.title),
          stages: ['unpack', 'parse'],
        });

        runIds.push(run.id);
      }

      onRunsStarted(entry.key, runIds);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="whitespace-nowrap">
          {entry.kind === 'bundle' ? 'Bundle' : 'Service'} {clamped + 1} of {entries.length}
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary transition-all"
            style={{ width: `${((clamped + 1) / entries.length) * 100}%` }}
          />
        </span>
      </div>

      <SourceGuide
        guide={guide}
        logo={
          entry.kind === 'bundle' ? `/import-logos/${entry.bundle.logo}` : serviceLogoUrl(entry.source.id)
        }
        badges={
          startedRuns.length > 0 ? (
            <Badge variant="outline" className="border-primary text-primary">
              upload started ✓
            </Badge>
          ) : null
        }
      >
        {notReady ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            This importer is not finished yet — the export instructions above still work, and an archive
            uploaded once it ships will import without re-exporting.
          </p>
        ) : (
          <DropZone
            compact
            label={`Drop your ${shortTitle(guide.title)} export here`}
            hint={
              entry.kind === 'bundle'
                ? 'Drop the whole export — every product inside it gets imported.'
                : 'It uploads straight to this appliance and starts processing below.'
            }
            disabled={busy || !api.ready}
            onFiles={(files) => void handleFiles(files)}
          />
        )}

        {busy && <p className="text-sm text-muted-foreground">Uploading…</p>}
        {error != null && <p className="text-sm text-destructive">{error}</p>}
      </SourceGuide>

      {startedRuns.map((runId) => (
        <LiveRun key={runId} runId={runId} />
      ))}

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => (clamped === 0 ? onBackToPick() : onIndex(clamped - 1))}>
          ← {clamped === 0 ? 'Services' : 'Previous'}
        </Button>

        {clamped < entries.length - 1 ? (
          <Button onClick={() => onIndex(clamped + 1)}>Next →</Button>
        ) : (
          <Button onClick={onFinish}>Finish → Sync</Button>
        )}
      </div>
    </div>
  );
}
