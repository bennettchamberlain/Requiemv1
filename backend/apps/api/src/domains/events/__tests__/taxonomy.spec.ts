import { describeJob, jobCategoryIndex, JOB_CATEGORIES, JOB_TYPES } from '../taxonomy';

/**
 * The taxonomy is the layer that makes the dashboard legible: without it, the
 * memory system reads as an undifferentiated wall of `file.uploaded` and
 * `smart.rotation.work`. Its failure mode is silent — an event that loses its
 * entry still renders, just uselessly — so the contract is pinned here.
 */
describe('job taxonomy', () => {
  it('describes the highest-volume events on a real appliance', () => {
    // Measured from pgboss.job + pgboss.archive: these five are ~99% of all
    // jobs ever run on the box this was written against.
    for (const event of [
      'file.uploaded',
      'preview.generated',
      'infer.question.answer',
      'file.updated',
      'smart.rotation.work',
    ]) {
      const descriptor = describeJob(event);

      expect(descriptor.label).not.toBe('Unclassified job');
      expect(descriptor.description.length).toBeGreaterThan(20);
    }
  });

  it('names the activity behind a rotation job rather than the event', () => {
    const generic = describeJob('smart.rotation.work');
    const specific = describeJob('smart.rotation.work', 'graph_enrich');

    // One event covers eleven unrelated activities. Showing the event name is
    // the same as showing nothing.
    expect(specific.label).toBe('Enrich graph entities');
    expect(specific.label).not.toBe(generic.label);
    expect(specific.description).toContain('Enrich graph entities');
  });

  it('falls back to the raw work type rather than hiding an unknown one', () => {
    expect(describeJob('smart.rotation.work', 'brand_new_thing').label).toBe('brand_new_thing');
  });

  it('classifies an unknown event instead of throwing', () => {
    expect(describeJob('not.a.real.event').label).toBe('Unclassified job');
    expect(describeJob(null).label).toBe('Unclassified job');
  });

  it('assigns every type to a real category', () => {
    const categories = new Set<string>(Object.values(JOB_CATEGORIES));

    // Collected rather than asserted per-entry so a failure names every bad
    // event at once instead of stopping at the first.
    const miscategorised = Object.entries(JOB_TYPES)
      .filter(([, descriptor]) => !categories.has(descriptor.category))
      .map(([event]) => event);

    const unlabelled = Object.entries(JOB_TYPES)
      .filter(([, descriptor]) => !descriptor.label)
      .map(([event]) => event);

    expect(miscategorised).toEqual([]);
    expect(unlabelled).toEqual([]);
  });

  it('indexes every type under exactly one category', () => {
    const index = jobCategoryIndex();
    const indexed = Object.values(index).flat();

    expect(indexed).toHaveLength(Object.keys(JOB_TYPES).length);
    expect(new Set(indexed).size).toBe(indexed.length);
  });

  it('covers the search-index lifecycle for every indexed entity', () => {
    // These are generated, so a missing one means the generator lost an entity
    // rather than that someone forgot to type it out.
    for (const entity of ['note', 'person', 'place', 'thread', 'communication']) {
      for (const verb of ['created', 'updated', 'deleted']) {
        expect(describeJob(`${entity}.${verb}`).category).toBe(JOB_CATEGORIES.search);
      }
    }
  });
});
