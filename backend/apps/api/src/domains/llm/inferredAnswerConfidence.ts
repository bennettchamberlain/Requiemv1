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
 * The ceiling a non-answer is allowed to carry — "I do not have this information
 * recorded", "I don't know", "not recorded".
 *
 * Measured failure this exists for: handed three browser records of the user
 * looking up directions to a Japanese, a Mexican and a Thai restaurant, the model
 * answered "I do not have this information recorded." and scored it 0.7 — above
 * `config.reflection.minAnswerConfidence`, so the refusal was written into the
 * user's own memory as though they had said it.
 *
 * The mistake is structural, not incidental: `confidence` means "how sure am I of
 * this answer", and a model that has refused scores how sure it is that it does
 * not know, which is the opposite quantity and is usually high. No wording of the
 * scale fixes that reliably, so {@link parseInferredAnswer} clamps it — see
 * {@link isNonAnswer}.
 */
export const CONFIDENCE_NON_ANSWER = 0.1;

/**
 * Floor used when nothing overrides it. Below this the appliance declines to
 * answer at all rather than write a guess into the user's memory — see
 * `config.reflection.minAnswerConfidence`, which is what production reads.
 */
export const DEFAULT_MIN_ANSWER_CONFIDENCE = CONFIDENCE_INDIRECT;

/**
 * Heuristic ceiling on how confident an inference is ALLOWED to be, grounded in
 * how much dossier + related Q&A + retrieved-memory context the prompt actually
 * carried.
 *
 * This is not the confidence itself — the model reports that (see
 * {@link calibrateInferredConfidence}). It is the correction for the failure
 * mode a self-reported score cannot catch: a model handed no dossier and no
 * prior answers, asked to speak as the user, will still cheerfully claim it is
 * certain. Evidence volume is knowable from this side of the call and the model
 * has no incentive to be honest about it, so the two are combined rather than
 * trusting either alone.
 *
 * `memoryEvidenceCount` is the number of RAG lines retrieved from the user's own
 * imported memory (RecallService). It is the term that makes real grounding
 * visible to the cap: without it, an answer read straight off the user's own
 * records was ceilinged identically to one invented from a two-line dossier, so
 * widening retrieval could not move the persisted confidence at all. Defaulted
 * to 0 so callers with no retrieval leg keep their previous ceiling exactly.
 */
export function estimateInferredAnswerConfidence(
  relatedAnswerCount: number,
  hasDossier: boolean,
  memoryEvidenceCount = 0,
): number {
  let score = 0.45;

  if (hasDossier) {
    score += 0.2;
  }

  score += Math.min(relatedAnswerCount, 6) * 0.07;

  // Slightly cheaper per line than a prior answer (a Q&A pair is a direct
  // statement; a retrieved line is raw material), but with a wider ceiling —
  // eight corroborating records is a genuinely different evidential position
  // from six prior answers about adjacent questions.
  score += Math.min(memoryEvidenceCount, 8) * 0.05;

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

- answer: the answer itself and nothing else. ONE short first-person sentence at most, and where the question is factual just the bare fact — "O positive", "Night owl", "Spanish and English", "Chicago". No preamble, no restating the question, no "honestly", no complimenting the question, no closing offer to elaborate.
- confidence: how sure you are that this is what THIS person would actually say, on this scale:
    >= ${CONFIDENCE_STATED}          they state it outright somewhere in the evidence below
    ${CONFIDENCE_STRONGLY_IMPLIED}-${CONFIDENCE_STATED}      strongly implied by repeated, consistent evidence
    ${CONFIDENCE_INDIRECT}-${CONFIDENCE_STRONGLY_IMPLIED}      inferred from indirect or partial evidence
    < ${CONFIDENCE_INDIRECT}           a guess — say so honestly; a low score here is correct and useful, and the answer will simply be discarded rather than held against you
- rationale: one line naming the specific evidence you used — quote or point at the EVIDENCE line, prior answer, or dossier fact, with its source label and date where the line carries one. If you had none, say that.

YOUR JOB IS SYNTHESIS, NOT LOOKUP. Almost nothing in this person's records is a statement of what they prefer; the records are a trail of what they actually did. Reading that trail is the work. There are two different things here and only one of them is forbidden:
- INVENTING — asserting something the evidence does not touch at all. Forbidden, always.
- INFERRING — naming the pattern that several evidence lines add up to. That is exactly what you are being asked for. Do NOT refuse because no line says it in so many words. Almost none ever will.

Evidence is usually INDIRECT, and indirect evidence is still evidence. A restaurant they went to is evidence about what they eat. An address they route to over and over is evidence about where they live or work. A subscription, a purchase, a repeated search is evidence of an interest. Who they message most is evidence about who matters to them. When their activity happens is evidence about their hours. Read through the record to the fact behind it.

Worked example — question: "What is your favorite cuisine?", evidence:
    [Browser] Directions to Choya Japanese Cuisine, Dana Point, CA
    [Browser] Directions to El Patroncito Mexican Cuisine, Los Angeles, CA
    [Browser] Directions to Pailin Thai Cuisine, Hollywood Blvd, Los Angeles
No line names a favorite. Three separate restaurants still say a great deal about what this person eats. CORRECT:
{"answer":"Japanese, Mexican and Thai — I eat across all three.","confidence":0.55,"rationale":"Three restaurants looked up in browser history: Choya (Japanese, Dana Point), El Patroncito (Mexican, LA), Pailin (Thai, Hollywood Blvd). None is stated as a favorite, so this names the range rather than picking one."}
WRONG, and the exact failure this instruction exists to stop:
{"answer":"I do not have this information recorded.","confidence":0.7,"rationale":"No line states a favorite cuisine."}
The evidence was sitting right there, and the score was backwards.

NEVER hedge in the answer field. "I'm not sure", "I haven't really thought about it", "it depends", "I don't have a strong preference" and anything like them are not answers — if the evidence does not support one, still give the single most likely short answer and put your uncertainty in \`confidence\` by scoring below ${CONFIDENCE_INDIRECT}. A low score is the honest signal and gets the answer discarded cleanly; a waffling sentence gets written into the user's memory as if they had said it.

A NON-ANSWER MUST SCORE LOW. If the answer text is any form of "I don't know", "I do not have this information recorded", "no information", "not recorded", "unknown" or "there is nothing in the evidence", then \`confidence\` MUST be at most ${CONFIDENCE_NON_ANSWER} — well below ${CONFIDENCE_INDIRECT}. \`confidence\` is how sure you are OF AN ANSWER, and a refusal is not one; it is not how sure you are that you don't know. Scoring a refusal 0.7 is always wrong, and it is clamped on arrival regardless, so the only thing a high score on a non-answer buys you is a discarded generation.

Never state a fact the evidence does not touch at all — but a consistent pattern across several lines IS the evidence touching it. Do not raise your confidence to make the answer look better, and do not lower it to avoid committing: an honest score is the point of this field.`;

/**
 * Answer texts that are refusals rather than answers, as the model actually
 * writes them.
 *
 * Anchored at the start wherever the phrase could legitimately appear mid-answer:
 * "there is nothing I enjoy more than surfing" is an answer, "there is no
 * information about that" is not, and only the second one should be caught. The
 * cost matrix is asymmetric but not one-sided — a missed refusal is persisted
 * into the user's memory looking exactly like something they typed, while a
 * false positive only leaves a question unanswered, which is where it already
 * was — so these lean broad but never so broad that a plain negative answer
 * ("I don't drink coffee", "None that I know of") trips them.
 */
const NON_ANSWER_PATTERNS: readonly RegExp[] = [
  /^i (?:really |honestly |truly |simply )?(?:do not|don't|dont) know\b/,
  /^i (?:do not|don't|dont) have (?:any |enough |sufficient |this |that |the |much |such )*(?:information|info|data|details?|records?|evidence|knowledge|context|answer)\b/,
  /^i (?:do not|don't|dont) have (?:this |that |it |any of this |any of that )?recorded\b/,
  /^i have no (?:information|info|data|details?|records?|evidence|knowledge|answer|way of knowing)\b/,
  /^i (?:do not|don't|dont) (?:recall|remember)\b/,
  /^i (?:cannot|can not|can't|cant|could not|couldn't|am unable to|am not able to) (?:determine|infer|answer|say|tell|know|find|provide)\b/,
  /^(?:this|that|the) (?:information|answer|detail|data) (?:is|was) not (?:recorded|available|known|specified|documented|present)\b/,
  /^no (?:information|info|data|evidence|records?|mention|indication|details?)\b/,
  /^not (?:recorded|available|known|specified|documented|mentioned|stated|applicable|enough information)\b/,
  /^there (?:is|are|was|were) (?:no|not enough|insufficient) (?:information|data|evidence|records?|mention|indication|details?)\b/,
  /^nothing (?:in|recorded|available|found|here|is recorded|was found)\b/,
  /^(?:the |my )?(?:evidence|data|records?|context|history)(?: below| provided| here)? (?:does|do|did) not\b/,
  /^insufficient (?:information|data|evidence|context)\b/,
  // Whole-answer only: "Unknown Pleasures by Joy Division" is an answer, and a
  // prefix match on "unknown" would throw it away.
  /^(?:unknown|unclear|unspecified|undetermined|n\/a|na)$/,
  /^(?:unknown|unclear|unspecified|undetermined) (?:from|based|in the|to me|at this|at present)\b/,
  // Same refusals with a lead-in the normalizer does not strip ("As the user, I
  // do not have this information recorded").
  /\b(?:i|we) (?:do not|don't|dont) have (?:this|that|any|enough|sufficient) (?:information|data|details?|evidence|context)\b/,
  /\bno (?:information|data|evidence|records?) (?:about|on|regarding|for|recorded|available|found)\b/,
  /\b(?:is|are) not recorded\b/,
];

/**
 * Is this answer text a refusal dressed as an answer?
 *
 * Used twice on purpose: {@link parseInferredAnswer} clamps the score so no
 * caller can persist a confident refusal, and AnswerInferenceListener drops the
 * row outright so a lowered floor cannot let one through anyway. A prompt rule
 * alone was not enough — the measured failure was a refusal self-scored at 0.7.
 */
export function isNonAnswer(answer: string): boolean {
  const normalized = (answer ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9'/\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:sorry|unfortunately|honestly|apologies|well|hmm+)\s+/, '');

  if (normalized.length === 0) {
    return false;
  }

  return NON_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized));
}

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
  const bounded = Math.min(Math.max(normalized, 0), 1);

  // The prompt states this rule; the clamp is what makes it true. A model that
  // has refused to answer scores how sure it is that it does not know — the
  // opposite quantity, and a high one — so a refusal arrives at 0.7 and clears a
  // 0.4 floor it was designed to fail. Clamping here rather than at the call site
  // means no future consumer of this parser has to remember the rule.
  const confidence = round2(isNonAnswer(answer) ? Math.min(bounded, CONFIDENCE_NON_ANSWER) : bounded);

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
