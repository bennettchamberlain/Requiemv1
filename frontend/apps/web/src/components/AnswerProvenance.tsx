import { Badge, cn } from '@ci/shadcn';

interface Props {
  /** `answerSource` as returned by the API. Undefined on rows that predate it. */
  source?: string | null;
  /** `answerConfidence` in [0,1]. Null/undefined whenever nothing scored the row. */
  confidence?: number | null;
  /** `answerRationale` — the model's one line on the evidence it used. */
  rationale?: string | null;
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
 */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) {
    return 'high confidence';
  }

  if (confidence >= 0.7) {
    return 'good confidence';
  }

  if (confidence >= 0.4) {
    return 'low confidence';
  }

  return 'very low confidence';
}

export function isInferred(source?: string | null): boolean {
  return source === 'inferred';
}

/**
 * The status light. Amber for an inference — the appliance guessed this and
 * would like you to look at it — and a flat neutral for anything the person or
 * their own data supplied, which needs no attention.
 *
 * Amber, not red: an inferred answer is unverified, not wrong. The colours are
 * the same functional (rather than intent) mapping `ConnectionModeIndicator`
 * uses, and are deliberately *not* graded by confidence band — the dot answers
 * "did a model write this?", and the words beside it answer "how sure was it?".
 * The dot is `aria-hidden` because it carries nothing the label does not.
 */
function ProvenanceDot({ inferred }: { inferred: boolean }) {
  return (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        inferred ? 'bg-amber-500' : 'bg-muted-foreground/50',
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Says who wrote an answer, and — when the appliance wrote it — how sure it was.
 *
 * The point of the component is that "the system guessed this on your behalf"
 * and "you said this" must never look alike. Before it, every row on the
 * Questions page rendered the same "Manual" badge regardless of provenance,
 * because the page inferred authorship from the presence of a `user` relation —
 * which every row has, since answers are user-scoped.
 *
 * Deliberately quiet: a word, not a percentage bar. The exact number lives in
 * the `title` tooltip alongside the model's rationale, so a reader who wants to
 * audit an answer can, and one who is just reading their reflections is not
 * asked to interpret two decimal places. Colour is never the only signal — the
 * badge always carries the words "Inferred" or "Manual" — so the distinction
 * survives greyscale and colour-blindness.
 */
export function AnswerProvenance({ source, confidence, rationale, className }: Props) {
  const inferred = isInferred(source);

  if (!inferred) {
    return (
      <Badge variant="secondary" className={cn('gap-1.5 text-xs', className)} title="You wrote this answer">
        <ProvenanceDot inferred={false} />
        Manual
      </Badge>
    );
  }

  const scored = typeof confidence === 'number' && Number.isFinite(confidence);
  const label = scored ? `Inferred · ${confidenceLabel(confidence)}` : 'Inferred';

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
    <Badge variant="outline" className={cn('gap-1.5 text-xs', className)} title={title}>
      <ProvenanceDot inferred />
      {label}
    </Badge>
  );
}
