import type { StageFailureContext } from './stageSummary';

/**
 * Attach "what was it working on" to a stage failure.
 *
 * ## The problem this exists for
 *
 * `ImportStageListener` records `(err as Error).message` into
 * `import_stages.error` and `import_runs.error`, and that is all a failed
 * import ever said. On the QA corpus that means a failed Google Takeout parse —
 * 703,956 items, 56 parser passes over 13 data sources, 45 minutes — would have
 * been reported to the user as, in full:
 *
 *     ENOENT: no such file or directory
 *
 * Which file? Which of the thirteen parsers? How far in? None of it survived,
 * and none of it can be recovered afterwards, because the scratch tree is
 * reclaimed with the run. A person cannot act on that and neither can an agent:
 * the only remaining move is to re-run the whole import and watch.
 *
 * ## What this changes
 *
 * A stage wraps the work it can name — a parser and the path it matched, an
 * archive being extracted, a destination and the batch being written — with
 * {@link withStageContext}. Anything thrown inside comes out as a
 * {@link StageContextError} carrying that context, with the ORIGINAL error as
 * `cause` so nothing about the exception is lost or reinterpreted.
 *
 * The listener then writes two things instead of one:
 *
 *  - `import_stages.error`, a single greppable line that leads with the
 *    context: `parse [dataSource=google_photos file=Takeout/Google Photos] ENOENT: ...`
 *  - `detail.summary.failure`, the same facts as fields, so an agent reads
 *    `failure.dataSource` rather than regexing the message.
 *
 * Context is ADDITIVE and never replaces the message. A stage that knows
 * nothing about what it was doing still produces exactly what it produced
 * before, which is why this can be adopted one call site at a time.
 */
export class StageContextError extends Error {
  readonly context: Omit<StageFailureContext, 'message' | 'name'>;

  constructor(context: Omit<StageFailureContext, 'message' | 'name'>, cause: unknown) {
    const inner = asError(cause);

    // The message keeps the context on the FRONT, because this is what lands in
    // a log line and in `import_runs.error`, and both are read left to right
    // and truncated from the right.
    super(`${formatContext(context)} ${inner.message}`.trim(), { cause: inner });

    this.name = 'StageContextError';
    this.context = context;
  }
}

/**
 * Run `work`, and re-throw anything it raises with `context` attached.
 *
 * Nested calls compose: an inner context (the file) merges over an outer one
 * (the data source) rather than replacing it, so the innermost frame that knew
 * something specific does not erase the frame that knew which parser it was.
 * Only the FIRST wrap for a given field wins, since that is the most specific
 * one — outer frames fill in what the inner frame did not know.
 *
 * A `DatabaseVolumeFullError` and anything else with its own meaning passes
 * through unchanged apart from the context: `cause` is the original object, and
 * {@link stageFailureContext} reports its class name, so a caller that switches
 * on the error type still can.
 */
export async function withStageContext<T>(
  context: Omit<StageFailureContext, 'message' | 'name'>,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof StageContextError) {
      // Inner wins per field; outer supplies what the inner frame lacked.
      throw new StageContextError({ ...context, ...definedOnly(err.context) }, err.cause ?? err);
    }

    throw new StageContextError(context, err);
  }
}

/**
 * The structured context for a thrown error, for `detail.summary.failure`.
 *
 * Works on any error. One that never met {@link withStageContext} yields just
 * `{ message, name }`, which is what the system recorded before — so adopting
 * this everywhere is not a precondition for it being useful anywhere.
 */
export function stageFailureContext(
  err: unknown,
  base: Omit<StageFailureContext, 'message' | 'name'> = {},
): StageFailureContext {
  const context = err instanceof StageContextError ? err.context : {};
  const inner = err instanceof StageContextError ? asError(err.cause ?? err) : asError(err);

  return {
    ...base,
    ...definedOnly(context),
    name: errorClassName(inner),
    message: inner.message,
  };
}

/**
 * The error's CLASS, not its `name` property.
 *
 * They differ, and the difference matters here: a subclass of `Error` inherits
 * `name === 'Error'` unless it assigns one, and `DatabaseVolumeFullError` — the
 * single most important error this pipeline raises, the one that means "your
 * rows are safe, free some disk and push again" rather than "your import is
 * broken" — does not assign one. Reporting it as a bare `Error` would throw
 * away the only field that tells the two apart at a glance.
 *
 * Falls back to `name` for the odd object that has no useful constructor.
 */
function errorClassName(err: Error): string {
  const ctor = (err as { constructor?: { name?: string } }).constructor?.name;

  return ctor != null && ctor.length > 0 && ctor !== 'Object' ? ctor : err.name;
}

/**
 * The one-line form written to `import_stages.error`.
 *
 * Bounded, because it is also copied onto `import_runs.error` and rendered in a
 * list: a stack trace or a 60kB Postgres error detail in a table cell helps
 * nobody. The full exception is still in the process log, which is where a
 * stack belongs.
 */
export function describeStageFailure(err: unknown, base: { stage?: string; phase?: string } = {}): string {
  const context = stageFailureContext(err, base);
  const { message, name: _name, ...fields } = context;
  const prefix = formatContext(fields);

  return truncate(prefix.length > 0 ? `${prefix} ${message}` : message, 1_000);
}

/**
 * `parse [dataSource=google_photos file=Takeout/Google Photos/photos.json]`
 *
 * Stage first and bare, then the rest as `key=value` inside brackets, in a
 * fixed order so two failures of the same shape are diffable and greppable.
 * Values are collapsed to one line and clipped: a path out of a real archive
 * can be several hundred characters of Unicode.
 */
function formatContext(context: Omit<StageFailureContext, 'message' | 'name'>): string {
  const order: Array<keyof Omit<StageFailureContext, 'message' | 'name'>> = [
    'phase',
    'dataSource',
    'file',
    'destination',
    'batchSize',
    'firstRowId',
    'stagedItemId',
  ];

  const parts = order
    .filter((key) => context[key] != null && String(context[key]).length > 0)
    .map((key) => `${key}=${truncate(String(context[key]).replace(/\s+/g, ' '), 200)}`);

  const stage = context.stage != null ? String(context.stage) : '';

  if (parts.length === 0) {
    return stage;
  }

  return `${stage} [${parts.join(' ')}]`.trim();
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v != null)) as Partial<T>;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
