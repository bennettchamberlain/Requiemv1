import { embedSkipReason, normalizeEmbeddableType, shouldEmbedType } from '../embeddable';

describe('normalizeEmbeddableType', () => {
  it('maps the capitalized graph vocabulary onto the lowercase search vocabulary', () => {
    expect(normalizeEmbeddableType('Person')).toBe('person');
    expect(normalizeEmbeddableType('Contact')).toBe('person');
    expect(normalizeEmbeddableType('Concept')).toBe('concept');
    expect(normalizeEmbeddableType('Location')).toBe('place');
    expect(normalizeEmbeddableType('Object')).toBe('item');
  });

  it('passes a value that already speaks the search vocabulary through unchanged', () => {
    expect(normalizeEmbeddableType('person')).toBe('person');
    expect(normalizeEmbeddableType('concept')).toBe('concept');
  });

  it('returns null for graph-only connective types and unknown types', () => {
    expect(normalizeEmbeddableType('Goal')).toBeNull();
    expect(normalizeEmbeddableType('Tag')).toBeNull();
    expect(normalizeEmbeddableType('Wormhole')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(normalizeEmbeddableType(null)).toBeNull();
    expect(normalizeEmbeddableType(undefined)).toBeNull();
  });
});

describe('shouldEmbedType', () => {
  it('is true for embeddable types (in either vocabulary) and false otherwise', () => {
    expect(shouldEmbedType('Person')).toBe(true);
    expect(shouldEmbedType('place')).toBe(true);
    expect(shouldEmbedType('Goal')).toBe(false);
    expect(shouldEmbedType(undefined)).toBe(false);
  });
});

describe('embedSkipReason', () => {
  it('returns null when content is present and the type is embeddable', () => {
    expect(embedSkipReason({ entityType: 'Person', searchContent: 'Dana Scully' })).toBeNull();
  });

  it('skips empty or whitespace-only content', () => {
    expect(embedSkipReason({ entityType: 'Person', searchContent: '' })).toBe('search content is empty');
    expect(embedSkipReason({ entityType: 'Person', searchContent: '   ' })).toBe('search content is empty');
    expect(embedSkipReason({ entityType: 'Person', searchContent: null })).toBe('search content is empty');
  });

  it('skips non-embeddable types, naming the offending type', () => {
    expect(embedSkipReason({ entityType: 'Goal', searchContent: 'be happy' })).toContain('Goal');
    expect(embedSkipReason({ entityType: undefined, searchContent: 'orphan content' })).toContain(
      '(unspecified)',
    );
  });

  it('prioritises the empty-content reason over the type reason', () => {
    // A blank document is uninteresting regardless of type — report that first.
    expect(embedSkipReason({ entityType: 'Goal', searchContent: '' })).toBe('search content is empty');
  });
});
