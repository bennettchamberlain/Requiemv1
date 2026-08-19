import {
  calibrateInferredConfidence,
  confidenceLabel,
  DEFAULT_MIN_ANSWER_CONFIDENCE,
  estimateInferredAnswerConfidence,
  INFERRED_ANSWER_JSON_SCHEMA,
  INFERRED_ANSWER_PROMPT_RULES,
  parseInferredAnswer,
} from '../inferredAnswerConfidence';

describe('estimateInferredAnswerConfidence', () => {
  it('scores thin context lower than rich RAG context', () => {
    expect(estimateInferredAnswerConfidence(0, false)).toBeLessThan(0.7);
    expect(estimateInferredAnswerConfidence(5, true)).toBeGreaterThanOrEqual(0.85);
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
});
