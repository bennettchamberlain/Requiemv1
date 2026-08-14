const TIME_ONLY = /^\d{1,2}:\d{2}$/;

const SCHEDULE_QUESTION =
  /\b(wake|waking|bed|sleep|workday|work day|start work|end work|go to bed|usual time)\b/i;

const AUTONOMY_QUESTION = /\b(companion do on its own|trust mode|autonom|auto-promote)\b/i;

const SETTING_ANSWER = /\b(auto-promote|high-confidence|hands.?off|cautious|balanced)\b/i;

/**
 * Longest text we will accept as a Concept LABEL.
 *
 * Deliberately equal to the key slice in CrossTableHydrationService
 * (`text.slice(0, 64)`): past this, the label and its dedupe key are both
 * truncated, so the node is named by an arbitrary cut of a sentence and two
 * different answers sharing a first 64 characters collide onto one concept.
 * If the text would be truncated at all, it is not a label.
 */
const MAX_CONCEPT_LABEL_CHARS = 64;

/** A label is a noun phrase ("Ice skating", "Science fiction"), not a clause. */
const MAX_CONCEPT_LABEL_WORDS = 6;

// There is deliberately no sentence-punctuation rule. The obvious one — a
// terminator followed by more text — also matches "Dr. Who", "Mt. Fuji",
// "St. Louis", which are exactly the short labels this path exists to capture.
// Dropping a real interest is a silent false negative, and the two caps below
// already reject every prose answer observed in the wild by a wide margin (the
// shortest was 81 chars / 14 words). A two-word oddity like "Yes. Mostly."
// slipping through costs one junk concept; losing "Dr. Who" costs a real one.

/**
 * Whether the text reads as prose rather than a concept label.
 *
 * The extractor was written for single-choice answers — "Choosing between
 * hiking, bowling, ice skating or arcading?" -> "Hiking" -> `self
 * INTERESTED_IN Hiking`. Free-text answers reach the same code path, and
 * without this check the whole paragraph became the concept name, sliced
 * mid-word. Real rows this produced, each asserted as an interest:
 *   "I am most proud of my capacity to be the proactive architect who estab"
 *   "I hope my legacy is the establishment of structured systems for human "
 * Skipping is the correct outcome, not re-filing the text elsewhere: hydration
 * READS ci.answers, so the answer is already stored — there is simply no
 * concept to extract from a paragraph, and inventing one poisons the graph
 * that RAG and insights read.
 */
function readsAsProse(text: string): boolean {
  return text.length > MAX_CONCEPT_LABEL_CHARS || text.split(/\s+/).length > MAX_CONCEPT_LABEL_WORDS;
}

/** Skip answer text that should not become a graph "interest" promotion. */
export function shouldSkipHydrationCandidate(text: string, questionText?: string | null): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }

  if (TIME_ONLY.test(trimmed)) {
    return true;
  }

  if (SETTING_ANSWER.test(trimmed)) {
    return true;
  }

  if (readsAsProse(trimmed)) {
    return true;
  }

  if (questionText) {
    if (SCHEDULE_QUESTION.test(questionText) || AUTONOMY_QUESTION.test(questionText)) {
      return true;
    }
  }

  return false;
}
