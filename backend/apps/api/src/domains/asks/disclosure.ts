import type { AskQuery, AnswerForm, DisclosedAnswer, DisclosedItem } from './types';

/**
 * Infer the answer FORM from the ask's query. The form drives disclosure
 * minimization: a `boolean`/`existence`/`attribute`/`identity` answer discloses
 * only a yes-no / count / synthesized value, never the underlying items, while a
 * `retrieval` answer may return item references. Pure.
 */
export function inferAnswerForm(query: AskQuery): AnswerForm {
  const queryType = query.queryType.toLowerCase();
  const prompt = query.prompt.toLowerCase();

  if (['identity', 'identity-claim', 'confirm', 'are-you'].includes(queryType)) {
    return 'identity';
  }

  if (['relationship', 'know', 'boolean'].includes(queryType) || prompt.startsWith('do you know')) {
    return 'boolean';
  }

  if (['attribute', 'where', 'address', 'value'].includes(queryType)) {
    return 'attribute';
  }

  if (queryType === 'existence') {
    return 'existence';
  }

  // photos / files / events / messages / … → the asker may receive references.
  return 'retrieval';
}

/** Only the retrieval form returns item references; all others disclose count/summary only. */
export function formDisclosesItems(form: AnswerForm): boolean {
  return form === 'retrieval';
}

/**
 * Build the disclosure-filtered answer from the raw run-as-owner matches.
 *
 * - The owner's redaction (`redactedIds` — the "deny all but X" set) is applied
 *   here; withheld items are COUNTED but never itemized to the asker.
 * - Only entity `{ id, type }` references cross — never raw node content or
 *   forwardable signed media URLs (the ask path returns references by design,
 *   which is what closes the `entityOwnerScope` signed-URL leak on this path).
 * - Non-retrieval forms carry no item references at all (disclosure minimization).
 *
 * Pure.
 */
export function buildDisclosedAnswer(params: {
  form: AnswerForm;
  matches: readonly DisclosedItem[];
  redactedIds?: readonly string[];
  consentBasis: string | null;
  responderLabel?: string;
}): DisclosedAnswer {
  const redacted = new Set(params.redactedIds ?? []);
  const kept = params.matches.filter((match) => !redacted.has(match.id));
  const withheldCount = params.matches.length - kept.length;
  const disclosedCount = kept.length;

  const items = formDisclosesItems(params.form)
    ? kept.map((item) => ({ id: item.id, type: item.type }))
    : [];

  return {
    form: params.form,
    items,
    disclosedCount,
    withheldCount,
    summary: buildSummary(params.form, disclosedCount, params.responderLabel ?? 'They'),
    consentBasis: params.consentBasis,
  };
}

/**
 * A templated, non-leaking summary. Replacing this with an LLM-synthesized
 * natural-language answer (completing the answer-inference RAG path) is a
 * follow-up; the template must never reveal more than the counts/form already do.
 */
function buildSummary(form: AnswerForm, count: number, who: string): string {
  switch (form) {
    case 'boolean':
      return count > 0 ? `${who} confirmed a match.` : `${who} found no match.`;
    case 'existence':
      return count > 0 ? `${who} has ${count} matching item${count === 1 ? '' : 's'}.` : `${who} has none.`;
    case 'attribute':
      return count > 0 ? `${who} shared the requested detail.` : `${who} had nothing to share.`;
    case 'identity':
      return count > 0 ? `${who} confirmed the identity.` : `No match found.`;
    case 'retrieval':
    default:
      return count > 0
        ? `${who} shared ${count} item${count === 1 ? '' : 's'}.`
        : `${who} had nothing to share.`;
  }
}
