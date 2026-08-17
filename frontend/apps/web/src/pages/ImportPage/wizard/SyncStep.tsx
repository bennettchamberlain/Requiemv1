import { useCallback, useEffect, useState } from 'react';

import { Alert, Button, Card } from '@ci/shadcn';

import { useImportApi, type ImportRun, type UnpushedRun } from '../useImportApi';

import { LiveRun } from './LiveRun';

export interface SyncStepProps {
  onBackToExport: () => void;
}

/**
 * Step 3: everything staged, pushed into the memory.
 *
 * The card lists every run whose parse finished but whose rows never reached
 * `ci.*` — including runs from an earlier abandoned session, which is the
 * point: nothing staged is ever silently stranded, and coming back to the
 * wizard later finishes the job. One button appends a push stage to all of
 * them; progress from there is the ordinary run poll, rendered per run.
 */
export function SyncStep({ onBackToExport }: SyncStepProps) {
  const api = useImportApi();
  const [unpushed, setUnpushed] = useState<UnpushedRun[] | null>(null);
  const [pushed, setPushed] = useState<ImportRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api.ready) {
      return;
    }

    try {
      setUnpushed(await api.listUnpushed());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSync() {
    setBusy(true);
    setError(null);

    try {
      const { runs } = await api.startPush();

      setPushed(runs);
      setUnpushed([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const pendingItems = (unpushed ?? []).reduce((sum, run) => sum + run.pendingItems, 0);
  const pendingEntities = (unpushed ?? []).reduce((sum, run) => sum + run.pendingEntities, 0);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Sync to your memory</h2>
        <p className="text-sm text-muted-foreground">
          Everything your uploads staged, saved into your Companion Memory in one go.
        </p>
      </div>

      {error != null && (
        <Alert variant="destructive">
          <span>{error}</span>
        </Alert>
      )}

      {unpushed == null && error == null && (
        <p className="text-sm text-muted-foreground">Checking what is waiting…</p>
      )}

      {unpushed != null && unpushed.length > 0 && (
        <Card className="space-y-3 p-4">
          <p className="text-sm">
            <strong>{pendingItems.toLocaleString()}</strong> item
            {pendingItems === 1 ? '' : 's'}
            {pendingEntities > 0 && (
              <>
                {' '}
                and <strong>{pendingEntities.toLocaleString()}</strong> connected{' '}
                {pendingEntities === 1 ? 'person or thing' : 'people and things'}
              </>
            )}{' '}
            staged across <strong>{unpushed.length}</strong> import
            {unpushed.length === 1 ? '' : 's'}, ready to save.
          </p>

          <ul className="space-y-1 text-sm text-muted-foreground">
            {unpushed.map((run) => (
              <li key={run.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{run.label ?? run.id}</span>
                <span className="whitespace-nowrap">
                  {run.pendingItems.toLocaleString()} item{run.pendingItems === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>

          <Button onClick={() => void handleSync()} disabled={busy || !api.ready}>
            {busy ? 'Starting…' : 'Sync to my memory'}
          </Button>
        </Card>
      )}

      {unpushed != null && unpushed.length === 0 && pushed == null && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing is waiting to sync — upload an export in the previous step first.
        </p>
      )}

      {pushed != null &&
        (pushed.length > 0 ? (
          pushed.map((run) => <LiveRun key={run.id} runId={run.id} />)
        ) : (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing was waiting to sync.
          </p>
        ))}

      <div>
        <Button variant="outline" onClick={onBackToExport}>
          ← Back to export
        </Button>
      </div>
    </div>
  );
}
