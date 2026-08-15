import { estimateInferredAnswerConfidence } from '../inferredAnswerConfidence';

describe('estimateInferredAnswerConfidence', () => {
  it('scores thin context lower than rich RAG context', () => {
    expect(estimateInferredAnswerConfidence(0, false)).toBeLessThan(0.7);
    expect(estimateInferredAnswerConfidence(5, true)).toBeGreaterThanOrEqual(0.85);
  });
});
