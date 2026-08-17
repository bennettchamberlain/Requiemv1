import '../../datasources';
import { allDataSources } from '../../datasources/registry';
import { WIZARD_SOURCES } from '../guides';

/**
 * `importerReady` has to mean what it says.
 *
 * The guides and the parser registry are authored separately — a guide is
 * written when someone works out how to get an export, an importer lands when
 * someone writes the parser — so nothing but this test stops the two drifting.
 * Upstream they had: nine working importers mislabelled as unready, and one
 * genuine stub advertised as ready. The second is the one that matters, because
 * it tells a person their export will import and then silently produces nothing.
 */
describe('importer readiness invariant', () => {
  const byName = new Map(allDataSources().map((source) => [source.name, source]));

  it('every ready source maps to a registered, implemented importer', () => {
    const offenders: string[] = [];

    for (const source of WIZARD_SOURCES) {
      if (!source.importerReady) {
        continue;
      }

      const name = source.importer ?? source.id;
      const dataSource = byName.get(name);

      if (!dataSource) {
        offenders.push(`${source.id} -> missing importer '${name}'`);
        continue;
      }

      if (dataSource.stub) {
        offenders.push(`${source.id} -> importer '${name}' is a stub`);
        continue;
      }

      if (!dataSource.newFileImporter && !dataSource.newAPIImporter) {
        offenders.push(`${source.id} -> importer '${name}' has no implementation`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('advertises no stub as ready', () => {
    const stubs = new Set(
      allDataSources()
        .filter((source) => source.stub)
        .map((source) => source.name),
    );
    const advertised = WIZARD_SOURCES.filter(
      (source) => source.importerReady && stubs.has(source.importer ?? source.id),
    );

    expect(advertised.map((source) => source.id)).toEqual([]);
  });

  it('still covers a substantial share of the catalog', () => {
    // Guards the derivation itself: if `importerReady` were dropped in a future
    // edit, every assertion above would pass vacuously.
    expect(WIZARD_SOURCES.filter((source) => source.importerReady).length).toBeGreaterThanOrEqual(50);
  });
});
