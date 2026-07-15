import { buildDisclosedAnswer, formDisclosesItems, inferAnswerForm } from './disclosure';
import type { AskQuery, DisclosedItem } from './types';

function query(overrides: Partial<AskQuery> = {}): AskQuery {
  return { queryType: 'photos', prompt: 'do you have photos of us?', ...overrides };
}

const MATCHES: DisclosedItem[] = [
  { id: 'a', type: 'file' },
  { id: 'b', type: 'file' },
  { id: 'c', type: 'event' },
];

describe('inferAnswerForm', () => {
  it('maps known query types to forms and defaults to retrieval', () => {
    expect(inferAnswerForm(query({ queryType: 'photos' }))).toBe('retrieval');
    expect(inferAnswerForm(query({ queryType: 'identity' }))).toBe('identity');
    expect(inferAnswerForm(query({ queryType: 'relationship' }))).toBe('boolean');
    expect(inferAnswerForm(query({ queryType: 'where' }))).toBe('attribute');
    expect(inferAnswerForm(query({ queryType: 'existence' }))).toBe('existence');
  });

  it('detects a "do you know" prompt as boolean', () => {
    expect(inferAnswerForm(query({ queryType: 'misc', prompt: 'Do you know Carol?' }))).toBe('boolean');
  });
});

describe('formDisclosesItems', () => {
  it('only the retrieval form returns item references', () => {
    expect(formDisclosesItems('retrieval')).toBe(true);
    for (const form of ['boolean', 'existence', 'attribute', 'identity'] as const) {
      expect(formDisclosesItems(form)).toBe(false);
    }
  });
});

describe('buildDisclosedAnswer', () => {
  it('retrieval form returns item references (id+type only, no raw content)', () => {
    const answer = buildDisclosedAnswer({ form: 'retrieval', matches: MATCHES, consentBasis: null });

    expect(answer.disclosedCount).toBe(3);
    expect(answer.withheldCount).toBe(0);
    expect(answer.items).toEqual([
      { id: 'a', type: 'file' },
      { id: 'b', type: 'file' },
      { id: 'c', type: 'event' },
    ]);
    // references only — the item objects carry no content/url keys
    expect(Object.keys(answer.items[0]).sort()).toEqual(['id', 'type']);
  });

  it('applies owner redaction: withheld items are counted but never itemized', () => {
    const answer = buildDisclosedAnswer({
      form: 'retrieval',
      matches: MATCHES,
      redactedIds: ['b', 'c'],
      consentBasis: 'grant-1',
    });

    expect(answer.disclosedCount).toBe(1);
    expect(answer.withheldCount).toBe(2);
    expect(answer.items).toEqual([{ id: 'a', type: 'file' }]);
    expect(answer.consentBasis).toBe('grant-1');
  });

  it('non-retrieval forms disclose counts/summary only — never item references', () => {
    const boolean = buildDisclosedAnswer({ form: 'boolean', matches: MATCHES, consentBasis: null });
    expect(boolean.items).toEqual([]);
    expect(boolean.disclosedCount).toBe(3); // still counted for the summary
    expect(boolean.summary).toMatch(/confirmed/i);

    const existenceNone = buildDisclosedAnswer({ form: 'existence', matches: [], consentBasis: null });
    expect(existenceNone.items).toEqual([]);
    expect(existenceNone.summary).toMatch(/none/i);
  });
});
