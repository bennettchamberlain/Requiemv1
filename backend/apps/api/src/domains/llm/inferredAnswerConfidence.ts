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
 * The ceiling an answer carries when the evidence never supplies the thing the
 * question asked for — see {@link AnswerSupport}'s `topical` and `none`.
 *
 * Deliberately the same number as {@link CONFIDENCE_NON_ANSWER}, because it is
 * the same event wearing a better sentence. "There are doctors in my family."
 * offered for "Which health conditions run in your immediate family?" is not a
 * partial answer that deserves a middling score; it is the absence of an answer,
 * stated fluently enough to look like one. Measured on the reference corpus, the
 * model scored exactly that 0.90.
 */
export const CONFIDENCE_OFF_QUESTION = CONFIDENCE_NON_ANSWER;

/**
 * The ceiling for an answer the evidence IMPLIES but never states.
 *
 * The published scale already says `>= ${CONFIDENCE_STATED}` means "they state
 * it outright". An inference read off a pattern — however consistent — has not
 * met that bar, so it may not enter that band. Sits at the top of the
 * strongly-implied band rather than at its floor: a well-supported inference is
 * still a good answer, it is just not a quotation.
 */
export const CONFIDENCE_IMPLIED_CEILING = 0.85;

/**
 * How the retrieved evidence stands to THE THING THE QUESTION ASKED FOR — not to
 * the question's topic. The distinction is the whole point: retrieval returns
 * what is lexically and topically nearby, and on most questions the nearest
 * material answers a different question.
 *
 * - `stated`  — a line supplies the asked-for thing outright.
 * - `implied` — no line supplies it, but a consistent pattern adds up to it.
 *               Three restaurant trips → what this person eats.
 * - `topical` — the lines are ABOUT the topic and never supply the asked-for
 *               thing. Doctors in the family are not health conditions; messages
 *               containing "skill" do not name a skill being practised this year.
 * - `none`    — the evidence does not touch the question at all.
 *
 * The model reports it (see {@link INFERRED_ANSWER_PROMPT_RULES}); this side
 * enforces it, because a self-reported relevance judgement is exactly as
 * trustworthy as a self-reported confidence.
 */
export const ANSWER_SUPPORT_LEVELS = ['stated', 'implied', 'topical', 'none'] as const;

export type AnswerSupport = (typeof ANSWER_SUPPORT_LEVELS)[number];

/**
 * Coerce whatever the model put in `support` to a known level, or `undefined`.
 *
 * Lenient on purpose. A strict `z.enum` in {@link inferredAnswerSchema} would
 * fail the WHOLE parse on an unrecognised word, throwing away a good answer over
 * a label — the opposite of the trade this field exists to make. An unreadable
 * label is simply an absent judgement.
 */
export function normalizeAnswerSupport(value: unknown): AnswerSupport | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  return ANSWER_SUPPORT_LEVELS.find((level) => level === normalized);
}

/**
 * Does the evidence actually answer the question that was asked?
 *
 * `undefined` — the model gave no judgement — counts as YES, so a caller that
 * never asked for one keeps its previous behaviour exactly. The gate is a new
 * constraint on a new field, not a new way for old callers to lose answers.
 */
export function answersTheQuestion(support: AnswerSupport | undefined): boolean {
  return support !== 'topical' && support !== 'none';
}

/**
 * The ceiling a support level allows, independent of how much evidence there was.
 *
 * This is the term that makes `confidence` mean "how well does the evidence
 * answer THIS question" rather than "how much material came back". Volume
 * saturates — on the reference corpus every question retrieves 15-23 lines, so
 * {@link estimateInferredAnswerConfidence} sits at its maximum for all of them,
 * relevant or not. Only this ceiling separates them.
 */
export function supportConfidenceCeiling(support: AnswerSupport | undefined): number {
  switch (support) {
    case 'implied':
      return CONFIDENCE_IMPLIED_CEILING;

    case 'topical':
    case 'none':
      return CONFIDENCE_OFF_QUESTION;

    // 'stated' and "no judgement given" are both unconstrained here: the model's
    // own score and the evidence ceiling are what govern them.
    default:
      return 1;
  }
}

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
  // ten corroborating records is a genuinely different evidential position
  // from six prior answers about adjacent questions.
  //
  // Ten rather than eight because `relatedAnswerCount` now counts only answers
  // the user TYPED (AnswerInferenceListener no longer feeds the model its own
  // prior guesses), which on a fresh appliance is zero: retrieval has to be able
  // to carry this ceiling on its own, or a fact quoted verbatim out of the
  // user's own archive would be capped below the band the prompt promises it.
  // Volume is being demoted here on purpose — it saturates on any real corpus
  // and says nothing about relevance. {@link supportConfidenceCeiling} is what
  // separates a well-answered question from a well-supplied one.
  score += Math.min(memoryEvidenceCount, 10) * 0.05;

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
 * sees; `confidence` and `rationale` are what make it auditable; `asked_for` and
 * `support` are the relevance judgement that decides whether there is an answer
 * to write at all.
 *
 * `support` is typed as a plain string rather than an enum on purpose — see
 * {@link normalizeAnswerSupport}. Both new fields are optional so a caller that
 * predates them still parses.
 *
 * Validated one field at a time by {@link parseInferredAnswer} rather than
 * trusted: schema-constrained generation guarantees the SHAPE, not that
 * `confidence` is a number in range or that `answer` is non-empty.
 */
export const inferredAnswerSchema = z.object({
  asked_for: z.string().optional(),
  support: z.string().optional(),
  answer: z.string(),
  confidence: z.number(),
  rationale: z.string().optional(),
});

export type InferredAnswer = {
  answer: string;
  confidence: number;
  rationale?: string;
  /** What the model understood the question to demand. Diagnostic only. */
  askedFor?: string;
  /** See {@link ANSWER_SUPPORT_LEVELS}. Absent when the model gave no judgement. */
  support?: AnswerSupport;
};

/**
 * The same shape as a JSON Schema, handed to Ollama's structured-output grammar.
 *
 * `format: 'json'` alone would only guarantee the output PARSES — the model
 * stays free to invent key names, and the small default chat model does. The
 * schema is what makes "the answer plus a score plus its evidence" a contract
 * rather than a request. See TaskBreakdownService for the same pattern and the
 * measurements behind it.
 *
 * Property ORDER is load-bearing, not cosmetic: the grammar emits the keys in
 * the order they are declared, so a decoder-only model writes `asked_for` and
 * `support` BEFORE `answer` and conditions the answer on them. Declared the
 * other way round they would be a post-hoc label on a sentence already
 * committed to — which is what the model does when left to itself, and what
 * produced "There are doctors in my family." at 0.90.
 */
export const INFERRED_ANSWER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    asked_for: { type: 'string' },
    support: { type: 'string', enum: [...ANSWER_SUPPORT_LEVELS] },
    answer: { type: 'string' },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['asked_for', 'support', 'answer', 'confidence', 'rationale'],
};

/**
 * The scale, as the model reads it. Exported so the prompt and the constants
 * above can never drift apart silently.
 */
export const INFERRED_ANSWER_PROMPT_RULES = `Return STRICT JSON only — no prose, no markdown fence:
{"asked_for":"...","support":"stated|implied|topical|none","answer":"...","confidence":0.0,"rationale":"..."}

Fill the fields IN THAT ORDER. \`asked_for\` and \`support\` are settled BEFORE you write a word of the answer, because together they decide whether there is an answer to write at all.

- asked_for: the exact thing this question demands, in a few words. Not its topic — the THING. "Which health conditions run in your immediate family?" demands NAMED MEDICAL CONDITIONS occurring in blood relatives; it does not demand facts about family, and it does not demand doctors. "What languages do you speak?" demands languages this person can already SPEAK. "Which languages are you learning?" demands languages they are STUDYING NOW. Two questions about one topic are still two different questions with two different answers.
- support: how the evidence stands to the thing \`asked_for\` names — NOT to the topic:
    stated   — some line supplies that thing outright ("I was born in Camarillo", "I am a night owl")
    implied  — no line supplies it, but a consistent pattern across several lines adds up to it (three restaurant trips → what this person eats)
    topical  — the lines are ABOUT the topic and never supply the thing. Doctors in the family are not health conditions. Messages containing the word "skill" do not name a skill being practised this year.
    none     — the evidence does not touch the question at all
  \`topical\` and \`none\` are near misses, and a near miss is not an answer: both are DISCARDED on arrival whatever score you attach, so report them honestly instead of reaching. Having a great deal to say about the topic is not the same as answering the question.
- answer: the answer itself and nothing else. ONE short first-person sentence at most, and where the question is factual just the bare fact — "O positive", "Night owl", "Spanish and English", "Chicago". No preamble, no restating the question, no "honestly", no complimenting the question, no closing offer to elaborate.
- confidence: how completely the evidence supplies THE THING \`asked_for\` NAMES. It is not how much evidence came back, not how on-topic the lines felt, not how fluent your sentence reads. Twenty lines that circle the topic without ever naming the thing are \`topical\` and score below ${CONFIDENCE_INDIRECT}; one line that states the thing outright is ${CONFIDENCE_STATED}. The scale:
    >= ${CONFIDENCE_STATED}          the evidence states the asked_for thing outright
    ${CONFIDENCE_STRONGLY_IMPLIED}-${CONFIDENCE_STATED}      the asked_for thing follows from repeated, consistent evidence
    ${CONFIDENCE_INDIRECT}-${CONFIDENCE_STRONGLY_IMPLIED}      the asked_for thing follows from indirect or partial evidence
    < ${CONFIDENCE_INDIRECT}           a guess, or evidence that only touches the topic — say so honestly; a low score here is correct and useful, and the answer will simply be discarded rather than held against you
- rationale: one line naming the specific evidence you used — quote or point at the EVIDENCE line or dossier fact, with its source label and date where the line carries one, and say which part of it supplies the asked_for thing. If nothing did, say that.

YOUR JOB IS SYNTHESIS, NOT LOOKUP. Almost nothing in this person's records is a statement of what they prefer; the records are a trail of what they actually did. Reading that trail is the work. There are two different things here and only one of them is forbidden:
- INVENTING — asserting something the evidence does not touch at all. Forbidden, always.
- INFERRING — naming the pattern that several evidence lines add up to. That is exactly what you are being asked for. Do NOT refuse because no line says it in so many words. Almost none ever will.

Evidence is usually INDIRECT, and indirect evidence is still evidence. A restaurant they went to is evidence about what they eat. An address they route to over and over is evidence about where they live or work. A subscription, a purchase, a repeated search is evidence of an interest. Who they message most is evidence about who matters to them. When their activity happens is evidence about their hours. Read through the record to the fact behind it.

Worked example — question: "What is your favorite cuisine?", evidence:
    [Browser] Directions to Choya Japanese Cuisine, Dana Point, CA
    [Browser] Directions to El Patroncito Mexican Cuisine, Los Angeles, CA
    [Browser] Directions to Pailin Thai Cuisine, Hollywood Blvd, Los Angeles
No line names a favorite. Three separate restaurants still say a great deal about what this person eats — cuisines are exactly what was asked for, and these lines supply them. CORRECT:
{"asked_for":"the cuisine I like best","support":"implied","answer":"Japanese, Mexican and Thai — I eat across all three.","confidence":0.55,"rationale":"Three restaurants looked up in browser history: Choya (Japanese, Dana Point), El Patroncito (Mexican, LA), Pailin (Thai, Hollywood Blvd). None is stated as a favorite, so this names the range rather than picking one."}
WRONG, and the exact failure this instruction exists to stop:
{"asked_for":"my favorite cuisine","support":"none","answer":"I do not have this information recorded.","confidence":0.7,"rationale":"No line states a favorite cuisine."}
The evidence was sitting right there, and the score was backwards. \`none\` means the evidence does not touch the question; restaurant trips touch a question about cuisine directly.

ANSWER THE QUESTION ASKED, NOT THE ONE THE EVIDENCE ANSWERS. Retrieval hands you whatever is lexically or topically nearby, and on a hard question the nearest material usually answers something else. So before you commit to a sentence, check it against \`asked_for\`: does it supply THAT thing, in the question's own terms? If your sentence would be an equally good answer to a neighbouring question, it is not an answer to this one — report \`topical\` and let it go. A question this archive cannot answer is supposed to come back unanswered; that is a working outcome, not a failure.

Worked example — question: "Which health conditions run in your immediate family?", evidence:
    [inbound, Nov 26, 2018] "doctors in my family."
    [inbound, Mar 1, 2017] "Especially within my family"
    [inbound, Jul 20, 2017] "Came back and immediately caught the flu 😷"
WRONG, and measured live on a real archive:
{"asked_for":"health in my family","support":"stated","answer":"There are doctors in my family.","confidence":0.9,"rationale":"[inbound, Nov 26, 2018] doctors in my family."}
Doctors are not conditions. A bout of flu is not a condition that RUNS in a family. Every one of those lines matched on "family" or "immediate" and not one names a hereditary condition — the answer scored ${CONFIDENCE_STATED} for being well-supported on the TOPIC while answering a different question. CORRECT:
{"asked_for":"named medical conditions occurring in my blood relatives","support":"topical","answer":"None that I know of.","confidence":0.1,"rationale":"Nothing here names a condition — the lines match on 'family' and 'immediate' only, and doctors in the family are not a diagnosis."}
A medical question answered out of adjacent material is the most damaging thing this system can produce. Wrong at ${CONFIDENCE_STATED} is far worse than absent.

EVIDENCE DOES NOT TRANSFER BETWEEN QUESTIONS. The same retrieved lines will be handed to you for several neighbouring questions, and answering all of them the same way makes every one but the closest a fabrication. Speaking a language is not learning one: a Duolingo install and "I studying for English and Sign Language" say what is being LEARNED and say nothing about what this person can already speak. A skill practised in 2019 is not "the skill I am working on this year" unless the evidence carries this year. Where the evidence answers the neighbouring question and only brushes yours, yours is \`topical\`.
Prior answers to OTHER questions are context, never source material. An answer already given elsewhere may not be restated as this question's answer and may not raise \`confidence\` by a single point — if the only thing supporting your sentence is that a nearby question was answered that way, \`support\` is \`topical\`.

NEVER hedge in the answer field. "I'm not sure", "I haven't really thought about it", "it depends", "I don't have a strong preference" and anything like them are not answers — if the evidence does not support one, still give the single most likely short answer and put your uncertainty in \`confidence\` by scoring below ${CONFIDENCE_INDIRECT}. A low score is the honest signal and gets the answer discarded cleanly; a waffling sentence gets written into the user's memory as if they had said it.

A NON-ANSWER MUST SCORE LOW. If the answer text is any form of "I don't know", "I do not have this information recorded", "no information", "not recorded", "unknown" or "there is nothing in the evidence", then \`confidence\` MUST be at most ${CONFIDENCE_NON_ANSWER} — well below ${CONFIDENCE_INDIRECT}. \`confidence\` is how sure you are OF AN ANSWER, and a refusal is not one; it is not how sure you are that you don't know. Scoring a refusal 0.7 is always wrong, and it is clamped on arrival regardless, so the only thing a high score on a non-answer buys you is a discarded generation.

SPEAK AS THE PERSON, NEVER ABOUT THEIR RECORDS. The answer field is what they would say out loud to someone who asked them — it is published on their own profile beside answers they typed themselves. So never narrate the corpus: no "My record shows", "in this record", "based on the evidence", "the data suggests", "the records indicate", "listing locations like", and never refer to yourself in the third person as "the user" or "this person". Naming the evidence is the job of \`rationale\`, and ONLY of \`rationale\`; an answer that mentions the record at all has been written in the wrong voice.
WRONG: {"answer":"My record shows a long-standing general interest in hobbies and supplies.","confidence":0.4}
RIGHT: {"answer":"Woodworking — about fifteen years now.","confidence":0.4}

ANSWER EVERY PART THE QUESTION ACTUALLY ASKS. "Which hobby have you kept the longest, and for how many years?" asks for a hobby AND a number of years; an answer naming neither is not a low-confidence answer, it is a non-answer wearing a sentence. Name the specific thing the question asked for — the hobby, the city, the language, the number. Restating the question's own category back at it ("hobbies and related intellectual topics", "various sports", "many different languages", "a strong interest in the subject") is vacuous and is worth nothing to this person: pick the single most likely SPECIFIC answer and score it honestly, or score below ${CONFIDENCE_INDIRECT} and let it be discarded.

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
  // Measured live miss: "I have not explicitly stated my pronouns in this
  // record." First person, no "I don't know" anywhere in it — what makes it a
  // refusal is that it reports on the RECORD's silence rather than answering.
  /^i have (?:not|never) (?:ever |explicitly |specifically |directly |clearly |openly |publicly |actually )*(?:stated|said|specified|mentioned|indicated|declared|expressed|described|discussed|recorded|documented|noted|listed|shared|provided|disclosed)\b/,
  // The same gap reported with the person's own attribute as the subject: "My
  // pronouns are not specified anywhere." Deliberately excludes "recorded",
  // which the whole-phrase guard above already owns.
  /\b(?:is|are|was|were) not (?:explicitly |specifically |directly |clearly |anywhere )*(?:stated|specified|mentioned|indicated|documented|listed|noted|captured|available|present|known)\b/,
  // The record as the sentence's subject with any verb of absence. The
  // "(?:does|do|did) not" guard above misses contractions and any intervening
  // words — "The evidence here doesn't mention that" cleared it untouched.
  /^(?:my|the|this|these|those|our) (?:own |provided |available |imported |indexed )?(?:records?|evidence|data|dataset|corpus|history|context|logs?|information)(?:\s+\w+){0,3}\s+(?:does not|doesn't|do not|don't|dont|did not|didn't|never|lacks?|contains? no|shows? no|has no|have no|is silent|are silent|says? nothing|mentions? nothing)\b/,
  // Measured live miss: "I do not have a description of my sexual orientation
  // to share." First person, names no record, and the absent thing is THE VERY
  // THING ASKED FOR — the tell is the trailing "to share/give/offer", which a
  // real answer never needs. Requiring that tail is what keeps "I don't have a
  // car" and "I do not have any siblings" (real answers) out of it.
  /^i (?:do not|don't|dont) have (?:a|an|any|the)\b(?:\s+\w+){0,6}\s+to (?:share|give|offer|provide|report|add|state|disclose)\b/,
];

/**
 * A reference to the RECORD itself rather than to the person's life — "in this
 * record", "based on the evidence", "according to my logs".
 *
 * The determiner is required on purpose: "in data" and "in the data" are not the
 * same claim, and "Data engineering." is a real answer to "what do you do?".
 */
const RECORD_REFERENCE =
  /\b(?:in|from|within|throughout|across|based on|according to|per) (?:this|that|the|my|our|these|those|your)(?: (?:own|provided|available|given|current|imported|indexed|supplied|above|below))? (?:records?|evidence|data|dataset|corpus|history|context|memory|memories|archive|logs?|information)\b/;

/**
 * Some claim that something is missing, unknown or absent.
 *
 * Never load-bearing alone — half of all real answers contain a negation
 * ("I don't drink coffee") — only in conjunction with {@link RECORD_REFERENCE}.
 */
const ABSENCE_CLAIM =
  /\b(?:no|not|never|nothing|none|nowhere|neither|silent|lacks?|lacking|absent|missing|unavailable|unspecified|unstated|unmentioned|undocumented|unclear|unknown|insufficient|cannot|can't|cant|doesn't|don't|dont|isn't|aren't|wasn't|weren't|hasn't|haven't)\b/;

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

  if (NON_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  // The structural tell, for the shapes no phrase list will ever enumerate: the
  // sentence is about what the RECORD contains, not about the person. Both
  // halves are required — a record reference alone can be a real answer ("I keep
  // it all in my logs") and a negation alone is half of everything anyone says
  // ("I don't drink coffee") — but together they are a report on a gap in the
  // corpus, which is the absence of an answer however fluently it is phrased.
  return RECORD_REFERENCE.test(normalized) && ABSENCE_CLAIM.test(normalized);
}

/**
 * Narrator lead-ins: the model describing the corpus before it gets round to
 * speaking as the person. Stripped rather than rejected — "My record shows I
 * have kept up with woodworking" is a real answer wearing a narrator's hat, and
 * throwing the whole row away would cost the user the fact inside it.
 */
const META_VOICE_LEAD_INS: readonly RegExp[] = [
  // "My record shows (that) …", "The records indicate …", "My data suggests …"
  /^(?:my|the|this|these|those|our|your) (?:own |provided |available |imported |indexed )?(?:records?|evidence|data|dataset|corpus|history|context|memory|memories|logs?|information)(?: below| above| here| provided| available)?,? (?:shows?|suggests?|indicates?|says?|states?|reflects?|implies|confirms?|reveals?|points? to|tells? me|contains?|notes?)(?: that)?[:,]?\s+/i,
  // "Based on the evidence, …", "According to my records, …"
  /^(?:based (?:on|upon)|according to|going by|judging (?:by|from)|drawing on|per|looking at|given) (?:my|the|this|these|those|our|your)(?: own| provided| available| imported| indexed)? (?:records?|evidence|data|dataset|corpus|history|context|memory|memories|logs?|information)(?: below| above| here| provided| available)?[,:]?\s+/i,
  // "It appears (from the record) that …" — narration with the corpus implied.
  /^it (?:appears|seems|looks like)(?: from (?:my|the|this) (?:records?|evidence|data|history|logs?))?(?: that)?,?\s+/i,
];

/**
 * The same leak arriving as a tail — "I prefer the beach, based on the evidence
 * below." Bare "in"/"from" are deliberately absent from the preposition set:
 * they would eat the end of "I work in the data".
 */
const META_VOICE_TAILS: readonly RegExp[] = [
  /[,;]?\s*(?:based (?:on|upon)|according to|going by|judging (?:by|from)|per|as (?:shown|recorded|noted|documented) in)\s+(?:my|the|this|these|those|our|your)(?:\s+(?:own|provided|available|imported|indexed))?\s+(?:records?|evidence|data|dataset|corpus|history|context|memory|memories|logs?|information)(?:\s+(?:below|above|here|provided|available))?\s*([.!?]?)$/i,
];

/**
 * Mid-sentence narration of the act of reading the corpus, measured live in
 * "I grew up all over, listing locations like San Diego, Yorba Linda, Seattle,
 * and Anchorage." The list is the answer; "listing locations like" is the model
 * describing its own retrieval, and a dash carries the same sentence without it.
 */
const META_VOICE_LISTING = /,?\s+listing\s+(?:\w+\s+)?(?:like|such as|including)\s+/gi;

/**
 * Strip narrator framing out of an answer, leaving the person speaking.
 *
 * Applied by {@link parseInferredAnswer} so it lands before the non-answer check
 * rather than after: "Based on the evidence, there is no mention of pronouns."
 * is a refusal that only looks like one once the frame is gone.
 *
 * Repair, not rejection. Only framing that can be removed without touching the
 * claim is removed here; narration that survives it is {@link isNarratedVoice}'s
 * problem, and that one drops the row.
 */
export function sanitizeInferredAnswerVoice(answer: string): string {
  let text = (answer ?? '').trim();

  for (const lead of META_VOICE_LEAD_INS) {
    text = text.replace(lead, '');
  }

  for (const tail of META_VOICE_TAILS) {
    text = text.replace(tail, '$1');
  }

  text = text.replace(META_VOICE_LISTING, ' — ').replace(/\s+/g, ' ').trim();

  // A stripped lead-in usually leaves a lowercase word where the sentence now
  // starts. Only ever raises the first letter — an answer that legitimately
  // begins lowercase ("iPhone", "e.e. cummings") is left as the model wrote it.
  if (text !== answer.trim() && /^[a-z]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text;
}

const NARRATED_VOICE_PATTERNS: readonly RegExp[] = [
  // The corpus named as a thing the answer is about. 'records'/'evidence'/
  // 'dataset'/'corpus' only: 'data' and 'history' are ordinary words in a real
  // answer ("Data engineering.", "I studied history").
  /\b(?:my|the|this|these|those|our) (?:own |provided |available |imported |indexed )?(?:records?|evidence|dataset|corpus)\b/,
  /\b(?:in|from|within|across|based on|according to|per) (?:this|that|the|my|our|these|those) (?:records?|evidence|dataset|corpus|data|history|context|logs?)\b/,
  // The record as narrator.
  /\b(?:the|my|this) (?:data|evidence|records?|history|logs?) (?:shows?|suggests?|indicates?|says?|reflects?|implies|confirms?|reveals?)\b/,
  // Third person about the person whose voice this is supposed to be. "the
  // user" is corpus-speak wherever it lands; "this person" / "the owner" only
  // as the sentence's subject, so a real answer that happens to contain the
  // phrase — "I'm the person everyone calls at 2am" — is left alone.
  /\bthe user\b/,
  /^(?:the|this) (?:user|person|individual|owner)\b/,
];

/**
 * Answers written in the wrong voice — narrating the user's data instead of
 * being the user.
 *
 * Checked AFTER {@link sanitizeInferredAnswerVoice} has removed the framing it
 * can remove, so what reaches here is narration woven into the claim itself
 * ("The user prefers mornings", "a strong interest, per my records") which
 * cannot be repaired without rewriting what the answer says.
 *
 * Same asymmetry as {@link isNonAnswer}: a false positive leaves a question
 * blank, which is where it already was, while a miss publishes "My record shows
 * …" on the user's own profile beside sentences they typed themselves. So an
 * answer that genuinely is about the user's records ("I keep my records in
 * Notion") is lost here, and that is the cheaper mistake.
 */
export function isNarratedVoice(answer: string): boolean {
  const normalized = (answer ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9'/\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length === 0) {
    return false;
  }

  return NARRATED_VOICE_PATTERNS.some((pattern) => pattern.test(normalized));
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

  // Voice repair happens here, before the length and non-answer checks below, so
  // every caller gets the same text and the refusal detector sees the sentence
  // with its narrator framing removed — "Based on the evidence, there is no
  // mention of pronouns." only reads as a refusal once the frame is gone.
  const answer = sanitizeInferredAnswerVoice(parsed.answer);

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
  const clamped = isNonAnswer(answer) ? Math.min(bounded, CONFIDENCE_NON_ANSWER) : bounded;

  // The same clamp, applied to the same failure one level up. A model that has
  // answered a NEARBY question scores how well the evidence supported the thing
  // it said — which is high, and is the wrong quantity twice over: the evidence
  // did support it, and it was not an answer to what was asked. Measured: "There
  // are doctors in my family." for "Which health conditions run in your
  // immediate family?", self-scored 0.90. The prompt states the rule; this makes
  // it true for every caller of the parser rather than only the careful ones.
  const support = normalizeAnswerSupport(parsed.support);
  const confidence = round2(Math.min(clamped, supportConfidenceCeiling(support)));

  const rationale = parsed.rationale?.trim();
  const askedFor = parsed.asked_for?.trim();

  return {
    answer,
    confidence,
    ...(rationale ? { rationale } : {}),
    ...(askedFor ? { askedFor } : {}),
    ...(support ? { support } : {}),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
