import { rankDataSources } from '../ParseStage';

/**
 * What a run gets NAMED after.
 *
 * The run list had only the uploaded filename, so a real archive read as
 * "All Data Categories.zip" instead of as Audible and Prime Video. Upstream
 * knew the service because the user picked its card before uploading; a drop
 * zone that accepts anything has to detect it — and one archive spans several
 * parsers, so the answer is a ranked list rather than a single name.
 */
describe('rankDataSources', () => {
  it('puts the source the archive is mostly about first', () => {
    // The real shape of the Amazon archive that prompted this.
    expect(
      rankDataSources([
        { dataSource: 'amazon', items: 3651, entities: 0 },
        { dataSource: 'audible', items: 4443, entities: 0 },
        { dataSource: 'prime_video', items: 1420, entities: 0 },
        { dataSource: 'amazon_music', items: 376, entities: 81 },
      ]),
    ).toEqual(['audible', 'amazon', 'prime_video', 'amazon_music']);
  });

  it('counts entities as well as items, so an entity-only source still appears', () => {
    // contact_list produced one entity and no items in a real run. Counting
    // items alone would have dropped it entirely.
    expect(rankDataSources([{ dataSource: 'contact_list', items: 0, entities: 1 }])).toEqual(['contact_list']);
  });

  it('drops a source that produced nothing', () => {
    // Recognising a file and then finding no rows in it is not something the
    // run was. `recognized` in the stage detail still records the match.
    expect(
      rankDataSources([
        { dataSource: 'spotify', items: 0, entities: 0 },
        { dataSource: 'audible', items: 12, entities: 0 },
      ]),
    ).toEqual(['audible']);
  });

  it('sorts a generic fallback to the end rather than letting it lead', () => {
    // `generic` matching a stray CSV must not be what a list calls the run.
    const ranked = rankDataSources([
      { dataSource: 'generic', items: 548, entities: 0 },
      { dataSource: 'audible', items: 4443, entities: 0 },
    ]);

    expect(ranked[0]).toBe('audible');
  });

  it('breaks ties on name, so a re-parse produces the same order', () => {
    const rows = [
      { dataSource: 'venmo', items: 10, entities: 0 },
      { dataSource: 'coinbase', items: 10, entities: 0 },
    ];

    expect(rankDataSources(rows)).toEqual(['coinbase', 'venmo']);
    expect(rankDataSources(rows)).toEqual(rankDataSources([...rows].reverse()));
  });

  it('survives a source entry with nothing useful on it', () => {
    // perSource is assembled from parser output, so it is not worth trusting to
    // always carry counts.
    expect(rankDataSources([{}, { dataSource: '' }, { dataSource: 'audible', items: 1 }])).toEqual(['audible']);
  });

  it('is empty for a run that parsed nothing', () => {
    expect(rankDataSources([])).toEqual([]);
  });
});
