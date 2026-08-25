import {
  calibrateInferredConfidence,
  confidenceLabel,
  CONFIDENCE_NON_ANSWER,
  DEFAULT_MIN_ANSWER_CONFIDENCE,
  estimateInferredAnswerConfidence,
  INFERRED_ANSWER_JSON_SCHEMA,
  INFERRED_ANSWER_PROMPT_RULES,
  isNonAnswer,
  parseInferredAnswer,
} from '../inferredAnswerConfidence';

describe('estimateInferredAnswerConfidence', () => {
  it('scores thin context lower than rich RAG context', () => {
    expect(estimateInferredAnswerConfidence(0, false)).toBeLessThan(0.7);
    expect(estimateInferredAnswerConfidence(5, true)).toBeGreaterThanOrEqual(0.85);
  });

  it('raises the ceiling for evidence retrieved from the user’s own memory', () => {
    // The point of the RAG leg: an answer read off the user's records must be
    // allowed to outscore one invented from the same thin dossier, or widening
    // retrieval cannot change anything that reaches the database.
    expect(estimateInferredAnswerConfidence(0, false, 6)).toBeGreaterThan(
      estimateInferredAnswerConfidence(0, false, 0),
    );
    expect(estimateInferredAnswerConfidence(0, false, 6)).toBeGreaterThan(DEFAULT_MIN_ANSWER_CONFIDENCE);
  });

  it('leaves the ceiling untouched for callers that pass no retrieval count', () => {
    expect(estimateInferredAnswerConfidence(3, true)).toBe(estimateInferredAnswerConfidence(3, true, 0));
  });

  it('never exceeds the cap, however much evidence is piled on', () => {
    expect(estimateInferredAnswerConfidence(50, true, 50)).toBe(0.95);
  });
});

describe('parseInferredAnswer', () => {
  it('reads answer, confidence and rationale out of a clean structured response', () => {
    const parsed = parseInferredAnswer(
      '{"answer":"I mostly drink tea.","confidence":0.82,"rationale":"You said so in the coffee question."}',
    );

    expect(parsed).toEqual({
      answer: 'I mostly drink tea.',
      confidence: 0.82,
      rationale: 'You said so in the coffee question.',
    });
  });

  it('tolerates a markdown fence and leading prose around the JSON', () => {
    const parsed = parseInferredAnswer(
      'Sure! Here is the JSON:\n```json\n{"answer":"Blue.","confidence":0.5,"rationale":"Two prior answers."}\n```',
    );

    expect(parsed?.answer).toBe('Blue.');
    expect(parsed?.confidence).toBe(0.5);
  });

  it('rescales a percentage-style confidence into [0,1]', () => {
    // Models emit `85` for "85%" about as readily as `0.85`.
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":85,"rationale":"x"}')?.confidence).toBe(0.85);
  });

  it('clamps an out-of-range confidence rather than storing it', () => {
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":-3,"rationale":"x"}')?.confidence).toBe(0);
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":400,"rationale":"x"}')?.confidence).toBe(1);
  });

  it('keeps the answer when the rationale is missing or blank, dropping the empty rationale', () => {
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":0.6}')).toEqual({
      answer: 'Yes.',
      confidence: 0.6,
    });
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":0.6,"rationale":"   "}')).toEqual({
      answer: 'Yes.',
      confidence: 0.6,
    });
  });

  it('returns null — never a substituted default — when confidence is absent or not a number', () => {
    // Inventing a score here would be the exact fabrication the floor exists to
    // prevent, so an unscored generation is a parse failure.
    expect(parseInferredAnswer('{"answer":"Yes.","rationale":"x"}')).toBeNull();
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":"very","rationale":"x"}')).toBeNull();
  });

  it('returns null for an empty answer, prose, or unparseable content', () => {
    expect(parseInferredAnswer('{"answer":"   ","confidence":0.9}')).toBeNull();
    expect(parseInferredAnswer('I think you probably like tea.')).toBeNull();
    expect(parseInferredAnswer('')).toBeNull();
    expect(parseInferredAnswer('{"tasks": [}')).toBeNull();
  });
});

describe('isNonAnswer', () => {
  it.each([
    // The measured failure: perfect restaurant evidence, refused anyway.
    'I do not have this information recorded.',
    "I don't have this information recorded",
    'I don’t know.',
    'I do not know what my favourite cuisine is.',
    'I have no information about that.',
    "I don't have enough information to answer.",
    'I cannot determine that from the evidence.',
    "I don't recall.",
    'No information recorded.',
    'No data available for this question.',
    'Not recorded.',
    'Unknown',
    'N/A',
    'There is no information about this in the evidence.',
    'Nothing in the evidence speaks to this.',
    'The evidence does not mention any cuisine.',
    'Insufficient information.',
    'Sorry, I do not have this information recorded.',
    'As the user, I do not have any information about that.',
    'That information is not recorded.',
  ])('flags the refusal %p', (answer) => {
    expect(isNonAnswer(answer)).toBe(true);
  });

  it.each([
    // Real answers that merely start with a negative, or contain a refusal-ish
    // word. Discarding these would cost a genuine answer.
    "I don't drink coffee.",
    "I don't eat meat.",
    'None that I know of.',
    'No siblings.',
    'There is nothing I enjoy more than surfing.',
    'Nothing beats a long drive.',
    'Japanese, Mexican and Thai — I eat across all three.',
    'Los Angeles.',
    'Night owl',
    'Unknown Pleasures by Joy Division.',
    'Data engineering.',
    'I know a fair bit of Spanish.',
  ])('leaves the real answer %p alone', (answer) => {
    expect(isNonAnswer(answer)).toBe(false);
  });

  it('is not tripped by an empty string', () => {
    expect(isNonAnswer('')).toBe(false);
    expect(isNonAnswer('   ')).toBe(false);
  });
});

describe('parseInferredAnswer — non-answer confidence clamp', () => {
  it('clamps the exact measured failure: a refusal self-scored at 0.7', () => {
    // Retrieval handed the model three restaurant visits; it refused and then
    // scored the refusal 0.7, clearing the 0.4 floor meant to filter it out.
    // `confidence` means "how sure am I of this answer" — there is no answer
    // here, so the score is answering a different question and must not stand.
    const parsed = parseInferredAnswer(
      '{"answer":"I do not have this information recorded.","confidence":0.7,"rationale":"No line states a favorite cuisine."}',
    );

    expect(parsed?.confidence).toBe(CONFIDENCE_NON_ANSWER);
    expect(parsed?.confidence).toBeLessThan(0.2);
    expect(parsed?.confidence).toBeLessThan(DEFAULT_MIN_ANSWER_CONFIDENCE);
  });

  it('clamps a refusal that arrives as a percentage too', () => {
    expect(parseInferredAnswer('{"answer":"Unknown.","confidence":90,"rationale":"x"}')?.confidence).toBe(
      CONFIDENCE_NON_ANSWER,
    );
  });

  it('does not raise a refusal that already scored itself honestly low', () => {
    // Clamp, not assignment: an honest 0.05 stays 0.05.
    expect(
      parseInferredAnswer('{"answer":"I don\'t know.","confidence":0.05,"rationale":"x"}')?.confidence,
    ).toBe(0.05);
  });

  it('leaves a real synthesized answer at the score the model gave it', () => {
    const parsed = parseInferredAnswer(
      '{"answer":"Japanese, Mexican and Thai — I eat across all three.","confidence":0.55,"rationale":"Three restaurants in browser history."}',
    );

    expect(parsed?.confidence).toBe(0.55);
  });
});

describe('calibrateInferredConfidence', () => {
  it('caps an overconfident model at what the available evidence supports', () => {
    // No dossier, no related answers: the model saying 0.95 does not make it so.
    const ceiling = estimateInferredAnswerConfidence(0, false);

    expect(calibrateInferredConfidence(0.95, ceiling)).toBe(ceiling);
  });

  it('keeps an honestly low model score even when evidence was plentiful', () => {
    expect(calibrateInferredConfidence(0.2, estimateInferredAnswerConfidence(6, true))).toBe(0.2);
  });

  it('clamps a model score outside [0,1] before comparing', () => {
    expect(calibrateInferredConfidence(-1, 0.9)).toBe(0);
    expect(calibrateInferredConfidence(2, 0.9)).toBe(0.9);
  });

  it('can land below the default floor, which is what makes the refusal reachable', () => {
    expect(calibrateInferredConfidence(0.25, 0.9)).toBeLessThan(DEFAULT_MIN_ANSWER_CONFIDENCE);
  });
});

describe('confidenceLabel', () => {
  it('labels each band of the documented scale', () => {
    expect(confidenceLabel(0.95)).toBe('high');
    expect(confidenceLabel(0.9)).toBe('high');
    expect(confidenceLabel(0.75)).toBe('moderate');
    expect(confidenceLabel(0.4)).toBe('low');
    expect(confidenceLabel(0.1)).toBe('very low');
  });
});

describe('the prompt contract', () => {
  it('requires every field the parser reads, so a schema-constrained model emits all three', () => {
    expect(INFERRED_ANSWER_JSON_SCHEMA.required).toEqual(['answer', 'confidence', 'rationale']);
  });

  it('states the scale to the model using the same numbers the code bands on', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('0.9');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('0.7');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('0.4');
  });

  it('asks for one short sentence or the bare fact, not a paragraph', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('ONE short first-person sentence');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('just the bare fact');
    expect(INFERRED_ANSWER_PROMPT_RULES).not.toContain('2-3 sentences');
  });

  it('routes uncertainty into the confidence score instead of into a hedging answer', () => {
    // The reported failure was a written answer reading "I'm not sure, I haven't
    // really thought about whether I prefer mornings or nights" — a non-answer
    // persisted as though the user had said it. The prompt must name that shape
    // and point it at the score instead.
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('NEVER hedge in the answer field');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain("I'm not sure");
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain("I haven't really thought about it");
  });

  it('separates inventing (forbidden) from inferring (the job)', () => {
    // The rules previously pushed only against fabrication, and the model read
    // that as "refuse unless a line says it outright" — so perfect evidence
    // produced "I do not have this information recorded."
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('SYNTHESIS, NOT LOOKUP');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('INVENTING');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('INFERRING');
    expect(INFERRED_ANSWER_PROMPT_RULES).toMatch(/indirect evidence is still evidence/i);
  });

  it('carries a worked example of the shape that was failing', () => {
    // Not decoration: the cuisine case is the measured failure, and showing the
    // correct output beside the wrong one is what makes the rule legible.
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('Japanese Cuisine');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('Thai Cuisine');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('I do not have this information recorded.');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('WRONG');
  });

  it('tells the model a non-answer scores low, using the number the code clamps to', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('A NON-ANSWER MUST SCORE LOW');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain(`at most ${CONFIDENCE_NON_ANSWER}`);
    expect(CONFIDENCE_NON_ANSWER).toBeLessThan(0.2);
  });
});
