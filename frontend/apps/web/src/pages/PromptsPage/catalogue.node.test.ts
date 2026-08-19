import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CATALOGUE_FILTERS,
  answerTierLabel,
  buildCatalogueQuery,
  catalogueUrl,
  rangeLabel,
} from './catalogue';

describe('buildCatalogueQuery', () => {
  it('omits empty search, category and tier rather than sending them blank', () => {
    const query = buildCatalogueQuery(DEFAULT_CATALOGUE_FILTERS);

    expect(query).toBe('status=active&answered=all&limit=25&offset=0');
  });

  it('trims the search term', () => {
    const query = buildCatalogueQuery({ ...DEFAULT_CATALOGUE_FILTERS, search: '  sleep  ' });

    expect(new URLSearchParams(query).get('search')).toBe('sleep');
  });

  it('drops a whitespace-only search entirely', () => {
    const query = buildCatalogueQuery({ ...DEFAULT_CATALOGUE_FILTERS, search: '   ' });

    expect(new URLSearchParams(query).has('search')).toBe(false);
  });

  it('encodes a category containing an ampersand', () => {
    const url = catalogueUrl({ ...DEFAULT_CATALOGUE_FILTERS, category: 'Health & Body' });

    expect(url).toContain('category=Health+%26+Body');
    expect(new URLSearchParams(url.split('?')[1]).get('category')).toBe('Health & Body');
  });

  it('carries paging through', () => {
    const params = new URLSearchParams(
      buildCatalogueQuery({ ...DEFAULT_CATALOGUE_FILTERS, limit: 50, offset: 100 }),
    );

    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('100');
  });
});

describe('answerTierLabel', () => {
  it('labels the three known tiers', () => {
    expect(answerTierLabel('factual')).toBe('Fact');
    expect(answerTierLabel('preference')).toBe('Preference');
    expect(answerTierLabel('narrative')).toBe('Story');
  });

  it('returns null for an untiered (pre-catalogue) reflection', () => {
    expect(answerTierLabel(null)).toBeNull();
    expect(answerTierLabel('something-else')).toBeNull();
  });
});

describe('rangeLabel', () => {
  it('places the page within the total', () => {
    // Locale-formatted, so build the expectation the same way rather than
    // pinning a separator the runtime may not use.
    expect(rangeLabel({ data: Array.from({ length: 25 }), offset: 25, totalCount: 1284 })).toBe(
      `26–50 of ${(1284).toLocaleString()}`,
    );
  });

  it('is null when there is nothing to place', () => {
    expect(rangeLabel({ data: [], offset: 0, totalCount: 0 })).toBeNull();
  });
});
