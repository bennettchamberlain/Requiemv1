import { z } from 'zod';

/**
 * The scale the model is told to score against, restated here so the numbers in
 * `ci.answers.answer_confidence` mean the same thing to the reader as they did
 * to the writer. Kept in step with `INFERRED_ANSWER_PROMPT_RULES` below — that
 * text is what the model actually sees.
 */
export const CONFIDENCE_STATED = 0.9;
export const CONFIDENCE_STRONGLY_IMPLIED = 0.7;
export const CONFIDENCE_INDIRECT = 0.4;

/**
 * Floor used when nothing overrides it. Below this the appliance declines to
 * answer at all rather than write a guess into the user's memory — see
 * `config.reflection.minAnswerConfidence`, which is what production reads.
 */
export const DEFAULT_MIN_ANSWER_CONFIDENCE = CONFIDENCE_INDIRECT;

/**
 * Heuristic ceiling on how confident an inference is ALLOWED to be, grounded in
 * how much dossier + related Q&A context the prompt actually carried.
 *
 * This is not the confidence itself — the model reports that (see
 * {@link calibrateInferredConfidence}). It is the correction for the failure
 * mode a self-reported score cannot catch: a model handed no dossier and no
 * prior answers, asked to speak as the user, will still cheerfully claim it is
 * certain. Evidence volume is knowable from this side of the call and the model
 * has no incentive to be honest about it, so the two are combined rather than
 * trusting either alone.
 */
export function estimateInferredAnswerConfidence(relatedAnswerCount: number, hasDossier: boolean): number {
  let score = 0.45;

  if (hasDossier) {
    score += 0.2;
  }

  score += Math.min(relatedAnswerCount, 6) * 0.07;

  return round2(Math.min(score, 0.95));
}

/**
 * The confidence actually persisted: the model's own score, capped by what the
 * available evidence could possibly support.
 *
 * `min` rather than an average on purpose. Either input being low is a real
 * reason for doubt — a model that admits uncertainty is right, and a prompt with
 * nothing in it cannot support certainty no matter how the model feels — so
 * averaging would let one side launder the other's weakness into a middling
 * score that reads as "probably fine".
 */
export function calibrateInferredConfidence(modelConfidence: number, evidenceCeiling: number): number {
  const bounded = Math.min(Math.max(modelConfidence, 0), 1);

  return round2(Math.min(bounded, evidenceCeiling));
}

/**
 * A human label for a score, so the UI and the logs describe the same number the
 * same way. Colour is never the only signal on the card; this text is.
 */
export function confidenceLabel(confidence: number): 'high' | 'moderate' | 'low' | 'very low' {
  if (confidence >= CONFIDENCE_STATED) {
    return 'high';
  }

  if (confidence >= CONFIDENCE_STRONGLY_IMPLIED) {
    return 'moderate';
  }

  if (confidence >= CONFIDENCE_INDIRECT) {
    return 'low';
  }

  return 'very low';
}

/**
 * What the model is asked to return. `answer` is the first-person text the user
 * sees; `confidence` and `rationale` are what make it auditable.
 *
 * Validated one field at a time by {@link parseInferredAnswer} rather than
 * trusted: schema-constrained generation guarantees the SHAPE, not that
 * `confidence` is a number in range or that `answer` is non-empty.
 */
export const inferredAnswerSchema = z.object({
  answer: z.string(),
  confidence: z.number(),
  rationale: z.string().optional(),
});

export type InferredAnswer = {
  answer: string;
  confidence: number;
  rationale?: string;
};

/**
 * The same shape as a JSON Schema, handed to Ollama's structured-output grammar.
 *
 * `format: 'json'` alone would only guarantee the output PARSES — the model
 * stays free to invent key names, and the small default chat model does. The
 * schema is what makes "the answer plus a score plus its evidence" a contract
 * rather than a request. See TaskBreakdownService for the same pattern and the
 * measurements behind it.
 */
export const INFERRED_ANSWER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['answer', 'confidence', 'rationale'],
};

/**
 * The scale, as the model reads it. Exported so the prompt and the constants
 * above can never drift apart silently.
 */
export const INFERRED_ANSWER_PROMPT_RULES = `Return STRICT JSON only — no prose, no markdown fence:
{"answer":"...","confidence":0.0,"rationale":"..."}

- answer: the first-person answer, 2-3 sentences max. No preamble, no "honestly", no complimenting the question.
- confidence: how sure you are that this is what THIS person would actually say, on this scale:
    >= ${CONFIDENCE_STATED}          they state it outright somewhere in the context below
    ${CONFIDENCE_STRONGLY_IMPLIED}-${CONFIDENCE_STATED}      strongly implied by repeated, consistent evidence
    ${CONFIDENCE_INDIRECT}-${CONFIDENCE_STRONGLY_IMPLIED}      inferred from indirect or partial evidence
    < ${CONFIDENCE_INDIRECT}           a guess — say so honestly; a low score here is correct and useful, and the answer will simply be discarded rather than held against you
- rationale: one line naming the specific evidence you used (which prior answer, which dossier fact). If you had none, say that.

Never invent facts absent from the context. Do not raise your confidence to make the answer look better — an honest low score is the point of this field.`;

/**
 * Parse the model's raw content into a validated inferred answer, or null if
 * nothing usable came back.
 *
 * Tolerant of markdown fences and leading prose (the same slice-to-outermost-braces
 * approach TaskBreakdownService and GraphEnrichmentService use), and returns null
 * rather than throwing: a bad generation should surface as "no answer was
 * inferred", never as an unhandled rejection inside a queue worker.
 *
 * A missing or non-finite `confidence` is a parse FAILURE, not a zero and not a
 * default: silently substituting a number would put a score in the database that
 * no model ever produced, which is exactly the fabrication this feature exists to
 * prevent. The caller decides what to do without one.
 */
export function parseInferredAnswer(content: string): InferredAnswer | null {
  let jsonStr = (content ?? '').replace(/```json\n?|\n?```/g, '').trim();

  const firstOpen = jsonStr.indexOf('{');
  const lastClose = jsonStr.lastIndexOf('}');

  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    jsonStr = jsonStr.substring(firstOpen, lastClose + 1);
  }

  let parsed: z.infer<typeof inferredAnswerSchema>;

  try {
    const result = inferredAnswerSchema.safeParse(JSON.parse(jsonStr));

    if (!result.success) {
      return null;
    }

    parsed = result.data;
  } catch {
    return null;
  }

  const answer = parsed.answer.trim();

  if (answer.length === 0 || !Number.isFinite(parsed.confidence)) {
    return null;
  }

  // Models emit percentages ("confidence": 85) about as readily as fractions.
  // Rescaling is safe because the scale in the prompt tops out at 1: anything
  // above it was meant as a percentage or is out of range either way, and both
  // readings clamp to the same place at the top.
  const normalized = parsed.confidence > 1 ? parsed.confidence / 100 : parsed.confidence;
  const confidence = round2(Math.min(Math.max(normalized, 0), 1));

  const rationale = parsed.rationale?.trim();

  return {
    answer,
    confidence,
    ...(rationale ? { rationale } : {}),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
