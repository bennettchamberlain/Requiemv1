import type { RunDetail } from '../controllers/ImportRunsController';

import type { ImportApiClient } from './client';
import type { Term } from './output';

/**
 * The run statuses that mean "nothing more will happen here".
 *
 * `partial` is terminal and success-ish, not a failure: a Takeout holding six
 * sources where one parser chokes has imported five, and waiting for it to
 * become `completed` would wait forever.
 */
export const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'partial',
  'cancelled',
]);

export interface WaitOptions {
  intervalMs?: number;
  /** Give up after this long. 0 (the default) waits as long as the import takes. */
  timeoutMs?: number;
  /** Injected in tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests; defaults to `Date.now`. */
  now?: () => number;
  quiet?: boolean;
}

export class WaitTimeoutError extends Error {
  constructor(readonly pending: RunDetail[]) {
    super(
      `Timed out waiting for ${pending.length} run(s): ${pending.map((run) => run.id).join(', ')}. ` +
        `The import is still going — follow it with \`ci-import runs <id>\`.`,
    );
    this.name = 'WaitTimeoutError';
  }
}

/**
 * Follow runs to their terminal state.
 *
 * Prints a line when something CHANGES — a stage begins, the percentage moves,
 * the run closes — rather than redrawing on a timer. That reads the same
 * whether stdout is a terminal or a log file, and it is what makes the wait
 * legible in CI, where a redrawn progress bar becomes thousands of lines of
 * escape codes.
 *
 * A run that vanishes mid-wait (deleted from another session) is dropped rather
 * than retried forever; a run that is already terminal returns on the first
 * poll without sleeping, which is what makes `--wait` free when the work is
 * already done.
 */
export async function waitForRuns(
  client: ImportApiClient,
  term: Term,
  runIds: readonly string[],
  options: WaitOptions = {},
): Promise<RunDetail[]> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 0;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  const startedAt = now();
  const pending = new Map<string, RunDetail | null>(runIds.map((id) => [id, null]));
  const finished: RunDetail[] = [];
  const lastLine = new Map<string, string>();

  while (pending.size > 0) {
    for (const runId of [...pending.keys()]) {
      let detail: RunDetail;

      try {
        detail = await client.getRun(runId);
      } catch {
        // Gone, or momentarily unreachable. Either way this wait has nothing
        // left to say about it.
        pending.delete(runId);
        continue;
      }

      if (!options.quiet) {
        const line = describe(detail, runIds.length > 1);

        if (lastLine.get(runId) !== line) {
          lastLine.set(runId, line);
          term.out(line);
        }
      }

      if (TERMINAL_RUN_STATUSES.has(detail.status)) {
        pending.delete(runId);
        finished.push(detail);
      } else {
        pending.set(runId, detail);
      }
    }

    if (pending.size === 0) {
      break;
    }

    if (timeoutMs > 0 && now() - startedAt >= timeoutMs) {
      throw new WaitTimeoutError([...pending.values()].filter((run): run is RunDetail => run != null));
    }

    await sleep(intervalMs);
  }

  return finished;
}

/** One run's current position, as a single line. */
function describe(run: RunDetail, prefixId: boolean): string {
  const active =
    run.stages.find((stage) => stage.status === 'running') ??
    [...run.stages].reverse().find((stage) => stage.status === 'completed');

  const where = active == null ? '' : ` ${active.kind}${active.phase ? `/${active.phase}` : ''}`;
  const counted = active?.total != null && active.total > 0 ? ` ${active.processed}/${active.total}` : '';
  const prefix = prefixId ? `[${run.id.slice(0, 8)}] ` : '';

  return `${prefix}${String(run.percent).padStart(3)}%  ${run.status}${where}${counted}`;
}
