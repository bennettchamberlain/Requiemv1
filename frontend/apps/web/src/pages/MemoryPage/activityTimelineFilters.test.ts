import { describe, expect, it } from 'vitest';

import { activityTimelineFiltersFromSearchParams } from './activityTimelineFilters';

describe('activityTimelineFiltersFromSearchParams', () => {
  it('returns undefined when no filters are active', () => {
    expect(activityTimelineFiltersFromSearchParams(new URLSearchParams())).toBeUndefined();
  });

  it('maps entity-type include lists to indexable types', () => {
    const params = new URLSearchParams({ includedEntityTypes: 'Note,Event' });

    expect(activityTimelineFiltersFromSearchParams(params)).toEqual({
      includeTypes: expect.arrayContaining(['note', 'event']),
    });
    expect(activityTimelineFiltersFromSearchParams(params)?.includeTypes).toHaveLength(2);
  });

  it('passes who/where/how and text filters through to the heatmap query', () => {
    const params = new URLSearchParams({
      people: 'Ada',
      places: 'Laguna Beach',
      connectors: 'gmail',
      eventTypes: 'email',
      tags: 'work',
      search: 'budget',
    });

    expect(activityTimelineFiltersFromSearchParams(params)).toEqual({
      people: ['Ada'],
      places: ['Laguna Beach'],
      connectors: ['gmail'],
      eventTypes: ['email'],
      tags: ['work'],
      query: 'budget',
    });
  });
});
