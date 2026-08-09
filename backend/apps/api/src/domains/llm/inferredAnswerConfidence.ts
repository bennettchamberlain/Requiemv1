/**
 * Heuristic confidence for RAG-based answer inference until we have model logprobs.
 * Grounded in how much dossier + related Q&A context was available for the inference.
 */
export function estimateInferredAnswerConfidence(
  relatedAnswerCount: number,
  hasDossier: boolean,
): number {
  let score = 0.45;

  if (hasDossier) {
    score += 0.2;
  }

  score += Math.min(relatedAnswerCount, 6) * 0.07;

  return Math.round(Math.min(score, 0.95) * 100) / 100;
}
