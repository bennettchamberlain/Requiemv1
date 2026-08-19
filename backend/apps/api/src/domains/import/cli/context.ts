import type { ImportApiClient } from './client';
import type { Term } from './output';

/** What every command is handed: somewhere to ask, somewhere to answer. */
export interface CliContext {
  client: ImportApiClient;
  term: Term;
}

/**
 * A failure the CLI expected and can explain — a path that is not a file, an
 * inbox that is not mounted, a stage name that does not exist.
 *
 * Distinct from a thrown `Error` so the entry point can print a sentence and
 * exit 2 for these, and a stack trace and exit 1 for anything else: the first
 * is the user's to fix, the second is ours.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 2,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
