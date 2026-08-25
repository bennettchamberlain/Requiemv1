import { cn } from '@ci/shadcn';

interface Props {
  /** `answerSource` as returned by the API. Undefined on rows that predate it. */
  source?: string | null;
  /** `answerConfidence` in [0,1]. Null/undefined whenever nothing scored the row. */
  confidence?: number | null;
  /** `answerRationale` — the model's one line on the evidence it used. */
  rationale?: string | null;
  /**
   * False when the question has no answer at all. Defaults to true so the many
   * call sites that only ever render alongside an answer stay unchanged.
   */
  answered?: boolean;
  className?: string;
}

/**
 * The confidence bands, worded for a reader rather than a statistician, and
 * matched to the scale the model is scored against in
 * `backend/.../llm/inferredAnswerConfidence.ts`:
 *
 *   >= 0.9   stated outright in the user's own data
 *   0.7-0.9  strongly implied by repeated, consistent evidence
 *   0.4-0.7  inferred from indirect or partial evidence
 *   < 0.4    a guess — the backend refuses to write these, so this band is
 *            reachable only for rows written before the floor existed
 *
 * The bare band word is what the badge shows; "confidence" is left implicit
 * there and spelled out in the tooltip and the screen-reader text.
 */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) {
    return 'high';
  }

  if (confidence >= 0.7) {
    return 'good';
  }

  if (confidence >= 0.4) {
    return 'low';
  }

  return 'very low';
}

export function isInferred(source?: string | null): boolean {
  return source === 'inferred';
}

/** Who supplied an answer, or that nobody has. */
type ProvenanceState = 'unanswered' | 'inferred' | 'manual';

/**
 * The status light, on a traffic-light mapping the user asked for: red nothing
 * here yet, amber the appliance guessed, green a person confirmed it.
 *
 * The dot is NOT graded by confidence band — it answers "where did this come
 * from?", and the word beside it answers "how sure was it?". `aria-hidden`
 * because the badge's screen-reader text already says both in words.
 */
function ProvenanceDot({ state }: { state: ProvenanceState }) {
  return (
    <span
      className={cn('inline-block size-1.5 shrink-0 rounded-full', {
        'bg-red-500': state === 'unanswered',
        'bg-amber-500': state === 'inferred',
        'bg-emerald-500': state === 'manual',
      })}
      aria-hidden="true"
    />
  );
}

/**
 * Says who wrote an answer, and — when the appliance wrote it — how sure it was.
 *
 * Deliberately terse: a dot and, for an inference, one band word ("high",
 * "very low"). A manual answer and an empty row carry the dot alone, because
 * naming them adds nothing a reader scanning a column of answers does not
 * already see. The exact score and the model's rationale live in the `title`
 * tooltip so an answer can still be audited.
 *
 * No badge chrome: a bordered pill around a 6px dot reads as a control rather
 * than a status, and one per unanswered row turned the column into a grid of
 * empty outlines. It is also ~40 fewer components on this page, which the
 * route-level render budget noticed.
 *
 * Colour is not the only signal, but it IS the only *visible* one at this size:
 * every badge carries visually-hidden text ("Inferred, high confidence") so the
 * distinction survives greyscale, colour-blindness and a screen reader. That is
 * the trade for the compact form — the words moved from the badge face into the
 * accessible name and the tooltip rather than being dropped.
 */
export function AnswerProvenance({ source, confidence, rationale, answered = true, className }: Props) {
  const base = 'inline-flex items-center gap-1.5 text-xs text-muted-foreground';

  if (!answered) {
    return (
      <span className={cn(base, className)} title="No answer yet">
        <ProvenanceDot state="unanswered" />
        <span className="sr-only">No answer yet</span>
      </span>
    );
  }

  if (!isInferred(source)) {
    return (
      <span className={cn(base, className)} title="You wrote this answer">
        <ProvenanceDot state="manual" />
        <span className="sr-only">Answered by you</span>
      </span>
    );
  }

  const scored = typeof confidence === 'number' && Number.isFinite(confidence);
  const band = scored ? confidenceLabel(confidence) : null;

  const title = [
    scored
      ? `Inferred from your data — confidence ${confidence.toFixed(2)}`
      : 'Inferred from your data — confidence not recorded',
    rationale || null,
    'Edit it to make it yours.',
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n');

  return (
    <span className={cn(base, className)} title={title}>
      <ProvenanceDot state="inferred" />
      <span className="sr-only">
        {band ? `Inferred, ${band} confidence` : 'Inferred, confidence not recorded'}
      </span>
      {band && <span aria-hidden="true">{band}</span>}
    </span>
  );
}
