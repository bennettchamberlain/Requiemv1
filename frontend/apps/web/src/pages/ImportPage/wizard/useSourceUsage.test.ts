import { describe, expect, it } from 'vitest';

import { creditedSources } from './useSourceUsage';

/**
 * The crediting rules behind the picker's "imported ✓" — born from a real
 * misfire: an Amazon "All Data Categories.zip" whose lone readme.md detected as
 * `notion` and whose address-book CSV detected as `contact_list`, lighting the
 * Notion and Outlook Contacts tiles for services never imported.
 */
describe('creditedSources', () => {
  it('a declared run credits declared ∩ detected — stray recognitions never escape the card', () => {
    // An Amazon-card drop: amazon-family importers declared; the greedy
    // recognizers still detect notion + contact_list inside.
    expect(
      creditedSources({
        dataSources: ['audible', 'amazon', 'prime_video', 'contact_list', 'notion'],
        declaredSources: ['amazon', 'audible', 'prime_video', 'amazon_music', 'kindle_reading'],
      }),
    ).toEqual(['audible', 'amazon', 'prime_video']);
  });

  it('a bundle declaration credits only the members the archive actually contained', () => {
    // Google card declares every member; this Takeout had no browser history.
    expect(
      creditedSources({
        dataSources: ['google_photos', 'gmail'],
        declaredSources: ['google_photos', 'gmail', 'chromium', 'calendar'],
      }),
    ).toEqual(['google_photos', 'gmail']);
  });

  it('an undeclared run credits only its dominant source (dataSources is most-rows-first)', () => {
    expect(
      creditedSources({
        dataSources: ['audible', 'amazon', 'contact_list', 'notion'],
        declaredSources: null,
      }),
    ).toEqual(['audible']);
  });

  it('treats runs from before the column existed (field absent) as undeclared', () => {
    expect(creditedSources({ dataSources: ['spotify'] })).toEqual(['spotify']);
  });

  it('credits nothing for an undeclared run that detected nothing', () => {
    expect(creditedSources({ dataSources: [], declaredSources: null })).toEqual([]);
  });
});
