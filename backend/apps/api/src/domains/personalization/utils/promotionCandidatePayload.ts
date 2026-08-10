export function promotionEvidenceText(evidence: unknown[] | undefined): string {
  const item = evidence?.find(
    (entry): entry is { text: string } =>
      typeof entry === 'object' && entry !== null && typeof (entry as { text?: unknown }).text === 'string',
  );

  return item?.text.trim() ?? '';
}

export function promotionValueText(
  payload: Record<string, unknown>,
  evidence: unknown[] | undefined = [],
): string {
  if (typeof payload.inferredText === 'string' && payload.inferredText.trim()) {
    return payload.inferredText.trim();
  }

  if (typeof payload.valueText === 'string' && payload.valueText.trim()) {
    return payload.valueText.trim();
  }

  return promotionEvidenceText(evidence);
}

export function promotionSourceQuestion(payload: Record<string, unknown>): string | null {
  if (typeof payload.questionText === 'string' && payload.questionText.trim()) {
    return payload.questionText.trim();
  }

  if (typeof payload.sourceQuestionText === 'string' && payload.sourceQuestionText.trim()) {
    return payload.sourceQuestionText.trim();
  }

  return null;
}

export function promotionRelationshipSummary(payload: Record<string, unknown>): string | null {
  const relationships = payload.relationships;
  if (!Array.isArray(relationships) || relationships.length === 0) {
    return null;
  }

  const first = relationships[0] as {
    fromKey?: string;
    toKey?: string;
    type?: string;
  };

  if (!first.fromKey || !first.toKey || !first.type) {
    return null;
  }

  return `${first.fromKey} — ${first.type} — ${first.toKey}`;
}

/** Legacy template prompts written before LLM-authored review copy. */
export function isLegacyReviewPrompt(reviewPrompt: string | null | undefined): boolean {
  const prompt = reviewPrompt ?? '';

  return (
    prompt.startsWith('Companion found a possible interest:') ||
    prompt.startsWith('Confirm this inferred answer:') ||
    prompt === 'Companion found a possible relationship in your recent activity.'
  );
}
