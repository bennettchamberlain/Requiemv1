import { Check, X } from '@ci/shadcn/icons';

import { isRunFinished, useRunsProgress, type ImportRun } from '../useImportApi';

import { LiveRun } from './LiveRun';

export interface LiveRunListProps {
  runIds: readonly string[];
  /** Detected services, already resolved to display titles — passed to active cards. */
  services?: readonly string[];
}

/**
 * Every run a card (or the Sync step) has started, rendered at the weight each
 * one deserves right now:
 *
 *  - **Finished runs collapse to one line** — name, yield, verdict. A Takeout
 *    of loose videos produces a hundred-plus single-file runs, and a hundred
 *    full pipeline cards is how the wizard tab pegged its renderer process
 *    (taking every same-site tab down with it, Chrome sharing renderers).
 *  - **Unfinished runs keep the full {@link LiveRun} card**, detailed stage
 *    bars and its own poll included. Parsing is single-file, so this is one or
 *    two cards, not a hundred — the detail stays where someone is watching.
 *
 * One shared runs-list poll ({@link useRunsProgress}) answers "which side of
 * that line is each run on"; it stops itself when everything is finished. A
 * run the list has not answered for yet gets the full card too — optimistic,
 * and identical to the pre-list behavior.
 */
export function LiveRunList({ runIds, services }: LiveRunListProps) {
  const runs = useRunsProgress(runIds);

  if (runIds.length === 0) {
    return null;
  }

  const finished = runIds.filter((id) => isRunFinished(runs.get(id)));
  const active = runIds.filter((id) => !isRunFinished(runs.get(id)));

  return (
    <div className="space-y-2">
      {finished.length > 0 && (
        <ul className="space-y-1 rounded-md border p-3 text-sm">
          {finished.map((id) => {
            const run = runs.get(id) as ImportRun;

            return <FinishedRow key={id} run={run} />;
          })}
        </ul>
      )}

      {active.map((id) => (
        <LiveRun key={id} runId={id} services={services} />
      ))}
    </div>
  );
}

/**
 * `failed`/`cancelled` are loud; `partial` keeps the check but says so — it is
 * a terminal SUCCESS state (one skipped row sets it), and rendering it as a
 * failure would tell most people their completed import broke.
 */
function FinishedRow({ run }: { run: ImportRun }) {
  const failed = run.status === 'failed' || run.status === 'cancelled';

  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {failed ? (
          <X className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        )}
        <span className="truncate" title={run.label ?? run.id}>
          {run.label ?? run.dataSources.join(', ') ?? run.id}
        </span>
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {failed ? (run.error ?? run.status) : run.records != null ? `${run.records} records` : 'parsed'}
        {run.status === 'partial' ? ' · partial' : ''}
      </span>
    </li>
  );
}
