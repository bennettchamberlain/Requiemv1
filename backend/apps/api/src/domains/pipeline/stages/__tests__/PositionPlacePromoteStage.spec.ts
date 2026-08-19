import { GeocodeService } from '@ci/domains/geocode';

import { POSITION_REVERSE_VERSION } from '../enrich/PositionReverseStage';
import { PLACE_PROMOTION_RULE_GENERATION, placeGroupKey } from '../promote/PlacePromoteStage';
import {
  POSITION_PLACE_LINK_RULE_GENERATION,
  PROMOTE_PLACE_POSITION_SOURCE,
  PROMOTE_PLACE_POSITION_STAGE_ID,
  PROMOTE_PLACE_POSITION_VERSION,
  PositionPlacePromoteStage,
  promotePlacePositionStageVersion,
} from '../promote/PositionPlacePromoteStage';

/**
 * `promote.place_position` — reverse-geocoded GPS fixes become first-class
 * places, and the fix gets linked to one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE REGRESSES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Measured on the legacy corpus after a COMPLETED enrichment pass: 5,005
 * `ci.geocode_cache` rows, 2,815 named `ci.position` fixes, 1,179 Location
 * entities — and `ci.position` rows carrying a `location_entity_id`: exactly 0.
 * `enrich.position_reverse` writes seven address columns and stops;
 * `promote.place` reads `ci.events` and requires `events.location_name`;
 * nothing at all read `ci.position`. Grepping for writers of
 * `position.location_entity_id` found entity declarations, DTOs and READ-side
 * consumers, and no writer. A fully drained reverse-geocode sweep therefore
 * produced ZERO places from GPS, forever, and the map stayed empty.
 *
 * So the assertions below are ordered by what actually failed:
 *
 *  1. **Selection never reads the output.** `location_entity_id` is what this
 *     stage writes; a predicate over it would rebuild the ratchet one table
 *     over.
 *  2. **It writes the column.** One `UPDATE ci.position`, addressed by the
 *     hypertable's real primary key `(time, user_id)` and bounded to the
 *     slice's own time range, or TimescaleDB scans every chunk.
 *  3. **It reads the REVERSE cache key.** The forward `hashQuery` canonicaliser
 *     strips '-', '.' and ',', which collapses all four coordinate quadrants
 *     onto one row. Using it here would attach a wrong-hemisphere hierarchy.
 *  4. **It never bills.** The hierarchy comes from cache rows
 *     `enrich.position_reverse` already paid for.
 *  5. **It cannot destroy another writer's answer,** and says so by name when
 *     it declines.
 */

/* ===================================================================== *
 * Fixtures
 * ===================================================================== */

const USER = '00000000-0000-4000-8000-0000000000aa';

/** A venue, and a fix ~140 m away that still lands in the same 0.001° cell group. */
const VENUE = { lat: 34.0203, lng: -118.2853 };
const VENUE_NEARBY = { lat: 34.02034, lng: -118.28528 };

const PLACE_ENTITY_ID = '00000000-0000-4000-8000-00000000cafe';
const OTHER_PLACE_ENTITY_ID = '00000000-0000-4000-8000-0000000000ff';

const FIX_TIME = '2019-04-02T18:30:00.000Z';

function positionId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

interface PositionRow {
  id: string;
  time: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  location_entity_id: string | null;
}

function positionRow(n: number, overrides: Partial<PositionRow> = {}): PositionRow {
  return {
    id: positionId(n),
    time: FIX_TIME,
    name: 'Student Union',
    lat: VENUE.lat,
    lng: VENUE.lng,
    location_entity_id: null,
    ...overrides,
  };
}

function makeLogger() {
  return { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/** One `ci.geocode_cache` row, in the shape the cache lookup selects. */
function cacheRow(queryHash: string) {
  return {
    query_hash: queryHash,
    place_id: 'ChIJ_fixture',
    components: {
      address_components: [
        { long_name: 'Los Angeles', types: ['locality'] },
        { long_name: 'California', types: ['administrative_area_level_1'] },
        { long_name: 'United States', types: ['country'] },
      ],
    },
  };
}

interface FakeOptions {
  rows?: PositionRow[];
  cache?: ReturnType<typeof cacheRow>[];
  /** Throw from the `UPDATE ci.position` link write. */
  failLinkWrite?: boolean;
  /** Throw from the geocode cache read. */
  failCacheRead?: boolean;
}

/**
 * A `DataSource` that answers each of the stage's three statements by
 * recognising it, and records every call so a test can assert on the SHAPE of
 * the work (one cache lookup, one link write) rather than on a SQL string.
 */
function fakeDataSource(options: FakeOptions = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  return {
    calls,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });

      // Most-specific first: the write also names `ci.position`.
      if (sql.includes('UPDATE ci.position p')) {
        if (options.failLinkWrite === true) {
          throw new Error('link write exploded');
        }

        return [];
      }

      if (sql.includes('FROM ci.geocode_cache')) {
        if (options.failCacheRead === true) {
          throw new Error('geocode cache unavailable');
        }

        const hashes = params[0] as string[];

        return (options.cache ?? []).filter((row) => hashes.includes(row.query_hash));
      }

      if (sql.includes('FROM ci.position p')) {
        const ids = params[0] as string[];

        return (options.rows ?? []).filter((row) => ids.includes(row.id));
      }

      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    }),
  };
}

/** A `PlaceService` that resolves everything to one entity, and counts the calls. */
function fakePlaceService(behaviour?: (name: string) => Promise<{ id: string; created: boolean }>) {
  return {
    findOrCreateForGeocode: jest.fn(async (_ctx: unknown, input: { name: string }) =>
      behaviour != null ? await behaviour(input.name) : { id: PLACE_ENTITY_ID, created: true },
    ),
  };
}

function makeStage(options: FakeOptions = {}, placeService = fakePlaceService()) {
  const dataSource = fakeDataSource(options);
  const stage = new PositionPlacePromoteStage(
    dataSource as never,
    placeService as never,
    makeLogger() as never,
  );

  return { stage, dataSource, placeService };
}

function linkWrite(dataSource: ReturnType<typeof fakeDataSource>) {
  return dataSource.calls.find((call) => call.sql.includes('UPDATE ci.position p'));
}

/* ===================================================================== *
 * 1. Candidate selection says what a row IS
 * ===================================================================== */

describe('PositionPlacePromoteStage — the applicability predicate', () => {
  const predicate = PROMOTE_PLACE_POSITION_SOURCE.predicate ?? '';

  it('never mentions location_entity_id — the column this stage writes', () => {
    // THE HEADLINE REGRESSION, one table over from `promote.place`'s.
    // `location_entity_id IS NULL` is the obvious predicate, it works, and it
    // is the ratchet: a fix promoted against a COLD reverse cache gets no
    // hierarchy at all, and with that predicate warming the cache could never
    // repair one of them, because they all have a link.
    expect(predicate).not.toMatch(/location_entity_id/i);
  });

  it('never anti-joins ci.entities, which is the same ratchet wearing a hat', () => {
    expect(predicate).not.toMatch(/ci\.entities/i);
  });

  it('is a clause, not a statement, and does not reach into the ledger', () => {
    // The three checks `StageRegistry.assertApplicabilityPredicate` makes at the
    // first sweep. Asserting them here fails in the unit suite instead.
    expect(predicate.trim()).not.toMatch(/^and\b/i);
    expect(predicate).not.toContain(';');
    expect(predicate).not.toMatch(/pipeline_state|\bp\./i);
  });

  it('requires an absolute coordinate, a ledger-addressable id, and a NAME', () => {
    // `location IS NOT NULL` excludes the RELATIVE fixes the `valid_positioning`
    // CHECK also permits; `id IS NOT NULL` because ci.pipeline_state.entity_id
    // is a typed uuid and ci.position.id is nullable; the name because a place
    // needs one — 2,815 of 65,115 fixes on the legacy corpus have a venue, and
    // promoting the other 62,300 GPS breadcrumbs would bury the real ones.
    expect(predicate).toMatch(/s\.location IS NOT NULL/i);
    expect(predicate).toMatch(/s\.id IS NOT NULL/i);
    expect(predicate).toMatch(/s\.name IS NOT NULL/i);
    expect(predicate).toMatch(/btrim\(s\.name\)/i);
  });

  it('rejects the non-place strings that reach ci.position.name', () => {
    // "Non-blank" is not "a place". The column's upstream is at least five-way:
    // a real waypoint name, a reverse-geocoded POI, a street address, a media
    // filename (titleFor hands a geotagged capture.* its own filename) and a
    // clipped message body all land in it. Promoting on non-blank alone mints a
    // Location per camera-roll photo — 2,085 rows / 2,063 distinct filenames on
    // this corpus — and buries the real venues.
    //
    // Asserted as SQL text because the predicate is a string handed to the
    // sweep; an integration test would need the hypertable. The paired
    // behavioural coverage lives with isNotAPlaceName in inputs.test.ts.
    expect(predicate).toMatch(/NOT \(/i);
    // media filename
    expect(predicate).toMatch(/jpe\?g\|png\|heic/i);
    // bare UUID stem
    expect(predicate).toMatch(/\[0-9a-f\]\{8\}-/i);
    // URI
    expect(predicate).toContain('[a-z][a-z0-9+.-]*://');
    // coordinate pair, bare or labelled
    expect(predicate).toMatch(/waypoint/i);
  });

  it('rejects a TITLE too — the fifth upstream, listed in the docblock but never covered', () => {
    // A message body, a social post and a ride narration all reach this column,
    // and "non-blank" read every one of them as a venue: on the corpus this
    // stage had already minted 7 Location entities with names like "Uber ride
    // from 520 4th St, San Francisco, CA 94107, US to 999 California St, San
    // Francisco, CA 94108, US (request)", out of 44 title-shaped names in 203
    // positions.
    //
    // Mirrors `isTitleText` (domains/import/push/inputs.ts) arm for arm. The
    // behavioural coverage lives there; what is asserted here is that the SQL
    // twin exists at all, because the two drifting is the failure this
    // predicate was written to prevent.

    // clip()'s truncation mark: the value is a PREFIX of a longer text.
    expect(predicate).toContain(String.raw`'…$'`);
    // Sentence punctuation — and NOT `.` or `@`, which real place names use
    // ('A.G. Bartlett Building', 'On Jane Stanford Way @ Gilbert Biological
    // Sciences' are both live ci.position.name values).
    expect(predicate).toContain(String.raw`'[!?]'`);
    expect(predicate).not.toContain('[.@]');
    // Longer than any place name observed, in words — MAX_PLACE_NAME_WORDS.
    expect(predicate).toContain(
      String.raw`array_length(regexp_split_to_array(btrim(s.name), '\s+'), 1) > 14`,
    );
  });

  it('sweeps ci.position keyed by id and scoped by user_id', () => {
    expect(PROMOTE_PLACE_POSITION_SOURCE).toEqual(
      expect.objectContaining({
        schema: 'ci',
        table: 'position',
        idColumn: 'id',
        userColumn: 'user_id',
      }),
    );
  });
});

/* ===================================================================== *
 * 2. The version is DERIVED from every input it reads
 * ===================================================================== */

describe('PositionPlacePromoteStage — the version', () => {
  it('derives from its own rule, the SHARED place rule, and the reverse-geocode pipeline', () => {
    expect(PROMOTE_PLACE_POSITION_VERSION).toBe(
      POSITION_PLACE_LINK_RULE_GENERATION + PLACE_PROMOTION_RULE_GENERATION + POSITION_REVERSE_VERSION - 2,
    );
  });

  it('tracks PLACE_PROMOTION_RULE_GENERATION, because the clustering key is shared', () => {
    // Not decoration: `placeGroupKey` is imported from `PlacePromoteStage`, so a
    // better dedupe rule there changes which place a fix resolves to here. A
    // version that ignored it would leave every fix pointing at the place the
    // OLD rule chose, with no way to re-open the row.
    const bumped =
      POSITION_PLACE_LINK_RULE_GENERATION +
      (PLACE_PROMOTION_RULE_GENERATION + 1) +
      POSITION_REVERSE_VERSION -
      2;

    expect(bumped).toBeGreaterThan(PROMOTE_PLACE_POSITION_VERSION);
  });

  it('is an integer >= 1, which versions.ts requires', () => {
    // 0 is reserved: `claim()` writes it and never advances it, so a row
    // abandoned by a SIGKILLed worker stays selectable.
    expect(Number.isInteger(PROMOTE_PLACE_POSITION_VERSION)).toBe(true);
    expect(PROMOTE_PLACE_POSITION_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('throws when STAGE_VERSIONS disagrees with the derivation', () => {
    expect(() =>
      promotePlacePositionStageVersion({
        [PROMOTE_PLACE_POSITION_STAGE_ID]: PROMOTE_PLACE_POSITION_VERSION + 7,
      }),
    ).toThrow(/declares .* but the stage derives/);
  });

  it('accepts a missing entry, so the spec does not depend on the wiring landing first', () => {
    expect(promotePlacePositionStageVersion({})).toBe(PROMOTE_PLACE_POSITION_VERSION);
  });

  it('reports the derived version and its permanent id on the instance', () => {
    const { stage } = makeStage();

    expect(stage.version).toBe(PROMOTE_PLACE_POSITION_VERSION);
    expect(stage.id).toBe(PROMOTE_PLACE_POSITION_STAGE_ID);
    expect(stage.entityTypes).toEqual(['position']);
  });
});

/* ===================================================================== *
 * 3. run() — the write that never existed
 * ===================================================================== */

describe('PositionPlacePromoteStage.run — it writes ci.position.location_entity_id', () => {
  it('promotes a named, located fix and links it to the resolved place', async () => {
    const { stage, placeService, dataSource } = makeStage({ rows: [positionRow(1)] });

    const results = await stage.run({ userId: USER }, [positionId(1)]);

    expect(results.size).toBe(1);
    expect(results.get(positionId(1))).toMatchObject({
      outcome: 'done',
      detail: { placeEntityId: PLACE_ENTITY_ID },
    });
    expect(placeService.findOrCreateForGeocode).toHaveBeenCalledTimes(1);

    const write = linkWrite(dataSource);

    expect(write).toBeDefined();
    expect(write!.sql).toMatch(/SET location_entity_id = u\.place_entity_id/);
    expect(write!.params[0]).toEqual([positionId(1)]);
    expect(write!.params[2]).toEqual([PLACE_ENTITY_ID]);
    expect(write!.params[3]).toBe(USER);
  });

  it('addresses the row by the hypertable PRIMARY KEY and bounds the slice by time', async () => {
    // `ci.position`'s PK is `(time, user_id)`; `id` carries only the index
    // 20260819000439 adds. Without the `time BETWEEN` bound TimescaleDB cannot
    // exclude a single chunk, and the write decompresses far more than it
    // touches. The `id` equality stays as the correctness check.
    const { stage, dataSource } = makeStage({
      rows: [positionRow(1), positionRow(2, { time: '2019-04-03T09:00:00.000Z' })],
    });

    await stage.run({ userId: USER }, [positionId(1), positionId(2)]);

    const write = linkWrite(dataSource)!;

    expect(write.sql).toMatch(/p\.id = u\.position_id/);
    expect(write.sql).toMatch(/p\.time = u\.fix_time/);
    expect(write.sql).toMatch(/p\.user_id = \$4::uuid/);
    expect(write.sql).toMatch(/p\.time >= \$5::timestamptz/);
    expect(write.sql).toMatch(/p\.time <= \$6::timestamptz/);

    expect(write.params[1]).toEqual([new Date(FIX_TIME), new Date('2019-04-03T09:00:00.000Z')]);
    expect(write.params[4]).toEqual(new Date(FIX_TIME));
    expect(write.params[5]).toEqual(new Date('2019-04-03T09:00:00.000Z'));
  });

  it('re-asserts ownership in the WHERE clause, not just in the read', async () => {
    // `decideLocally` ran against a snapshot taken before the PlaceService round
    // trips, so a concurrent writer could have claimed the link in between.
    const { stage, dataSource } = makeStage({ rows: [positionRow(1)] });

    await stage.run({ userId: USER }, [positionId(1)]);

    expect(linkWrite(dataSource)!.sql).toMatch(
      /p\.location_entity_id IS NULL[\s\S]*OR p\.location_entity_id = u\.place_entity_id/,
    );
  });

  it('links every fix in ONE statement, not one per row', async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => positionRow(n));
    const { stage, dataSource } = makeStage({ rows });

    await stage.run(
      { userId: USER },
      rows.map((row) => row.id),
    );

    const writes = dataSource.calls.filter((call) => call.sql.includes('UPDATE ci.position p'));

    expect(writes).toHaveLength(1);
    expect(writes[0].params[0]).toHaveLength(5);
  });

  it('answers for ids the load did not return, rather than leaving them silent', async () => {
    const { stage } = makeStage({ rows: [positionRow(1)] });

    const results = await stage.run({ userId: USER }, [positionId(1), positionId(2)]);

    expect(results.size).toBe(2);
    expect(results.get(positionId(2))).toEqual({ outcome: 'skipped', reason: 'source_row_missing' });
  });

  it.each([
    ['no_coordinates', { lat: null, lng: null }],
    ['invalid_coordinates', { lat: Number.NaN, lng: Number.NaN }],
    ['no_location_name', { name: '   ' }],
  ])('skips with reason %s, before any place resolution', async (reason, overrides) => {
    const { stage, placeService } = makeStage({ rows: [positionRow(1, overrides)] });

    const results = await stage.run({ userId: USER }, [positionId(1)]);

    expect(results.get(positionId(1))).toEqual({ outcome: 'skipped', reason });
    expect(placeService.findOrCreateForGeocode).not.toHaveBeenCalled();
  });

  it('every non-done result carries a reason, which PipelineStateService enforces', async () => {
    const { stage } = makeStage({
      rows: [positionRow(1), positionRow(2, { name: null }), positionRow(3, { lat: null })],
    });

    const results = await stage.run({ userId: USER }, [
      positionId(1),
      positionId(2),
      positionId(3),
      positionId(4),
    ]);

    for (const [id, result] of results) {
      if (result.outcome !== 'done') {
        expect({ id, reason: result.reason }).toMatchObject({ id, reason: expect.any(String) });
        expect(result.reason?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

/* ===================================================================== *
 * 4. Ownership — it cannot destroy another writer's answer
 * ===================================================================== */

describe('PositionPlacePromoteStage.run — ownership', () => {
  it('refuses to re-point a link that points somewhere else', async () => {
    const { stage, dataSource } = makeStage({
      rows: [positionRow(1, { location_entity_id: OTHER_PLACE_ENTITY_ID })],
    });

    const results = await stage.run({ userId: USER }, [positionId(1)]);

    expect(results.get(positionId(1))).toMatchObject({
      outcome: 'skipped',
      reason: 'place_link_not_owned',
      detail: { locationEntityId: OTHER_PLACE_ENTITY_ID },
    });
    // And it wrote nothing at all — an importer's better-informed answer
    // survives every version bump of this stage.
    expect(linkWrite(dataSource)).toBeUndefined();
  });

  it('records done WITHOUT a write when the fix already points at the place it resolves', async () => {
    // `ci.position` has no jsonb provenance bag, so "already promoted" can only
    // be established by resolving and comparing. Recording `done` here is what
    // keeps a version bump from reporting `place_link_not_owned` for a corpus
    // that is already exactly right — and skipping the UPDATE is what keeps it
    // from decompressing a TimescaleDB chunk to write a value that is already
    // there.
    const { stage, dataSource } = makeStage({
      rows: [positionRow(1, { location_entity_id: PLACE_ENTITY_ID })],
    });

    const results = await stage.run({ userId: USER }, [positionId(1)]);

    expect(results.get(positionId(1))).toMatchObject({
      outcome: 'done',
      detail: { placeEntityId: PLACE_ENTITY_ID, unchanged: true },
    });
    expect(linkWrite(dataSource)).toBeUndefined();
  });

  it('promotes the unlinked fixes in a slice even when a sibling is foreign-linked', async () => {
    const { stage, dataSource } = makeStage({
      rows: [positionRow(1), positionRow(2, { location_entity_id: OTHER_PLACE_ENTITY_ID })],
    });

    const results = await stage.run({ userId: USER }, [positionId(1), positionId(2)]);

    expect(results.get(positionId(1))).toMatchObject({ outcome: 'done' });
    expect(results.get(positionId(2))).toMatchObject({ reason: 'place_link_not_owned' });
    expect(linkWrite(dataSource)!.params[0]).toEqual([positionId(1)]);
  });
});

/* ===================================================================== *
 * 5. Cost — a promoter that bills is a promoter nobody re-runs
 * ===================================================================== */

describe('PositionPlacePromoteStage.run — it reads the reverse cache and never a provider', () => {
  it('takes no geocode service at all, so it structurally cannot bill', () => {
    // The constructor arity IS the assertion: DataSource, PlaceService, Logger.
    // Adding `GeocodeService` here would let a cache miss reach a metered
    // provider on every version bump.
    expect(PositionPlacePromoteStage.length).toBe(3);
  });

  it('looks the cache up by the REVERSE key, never the forward hashQuery', async () => {
    // The regression that would be invisible in production: hashQuery's
    // canonicalize() strips '-', '.' and ',', collapsing (34.02, -118.28) onto
    // the same row as (-34.02, 118.28). The place would still be created — with
    // a wrong-hemisphere city, region and country.
    const { stage, dataSource } = makeStage({ rows: [positionRow(1)] });

    await stage.run({ userId: USER }, [positionId(1)]);

    const lookup = dataSource.calls.find((call) => call.sql.includes('FROM ci.geocode_cache'))!;
    const hashes = lookup.params[0] as string[];

    expect(hashes).toContain(GeocodeService.hashReverseQuery(VENUE.lat, VENUE.lng));
    expect(hashes).not.toContain(GeocodeService.hashQuery('Student Union'));
    expect(hashes).not.toContain(GeocodeService.hashReverseQuery(-VENUE.lat, -VENUE.lng));
  });

  it('passes the cached place_id and components straight through to the hierarchy', async () => {
    const hash = GeocodeService.hashReverseQuery(VENUE.lat, VENUE.lng);
    const { stage, placeService } = makeStage({ rows: [positionRow(1)], cache: [cacheRow(hash)] });

    await stage.run({ userId: USER }, [positionId(1)]);

    expect(placeService.findOrCreateForGeocode).toHaveBeenCalledWith(
      { userId: USER },
      expect.objectContaining({
        name: 'Student Union',
        placeId: 'ChIJ_fixture',
        components: expect.objectContaining({ address_components: expect.any(Array) }),
      }),
    );
  });

  it('collects every member cell of a group, not only the first fix’s', async () => {
    // A group is a 0.001° cell (~111 m); the reverse cache is keyed at 4
    // decimals (~11 m). One venue therefore spans many cache rows, and the
    // hierarchy must be found through whichever of them `enrich.position_reverse`
    // actually resolved.
    const nearbyHash = GeocodeService.hashReverseQuery(VENUE_NEARBY.lat, VENUE_NEARBY.lng);
    const { stage, placeService } = makeStage({
      rows: [positionRow(1), positionRow(2, { lat: VENUE_NEARBY.lat, lng: VENUE_NEARBY.lng })],
      cache: [cacheRow(nearbyHash)],
    });

    // Same group, so one resolution — and it carries the sibling's hierarchy.
    expect(placeGroupKey('Student Union', VENUE.lat, VENUE.lng)).toBe(
      placeGroupKey('Student Union', VENUE_NEARBY.lat, VENUE_NEARBY.lng),
    );

    await stage.run({ userId: USER }, [positionId(1), positionId(2)]);

    expect(placeService.findOrCreateForGeocode).toHaveBeenCalledTimes(1);
    expect(placeService.findOrCreateForGeocode).toHaveBeenCalledWith(
      { userId: USER },
      expect.objectContaining({ placeId: 'ChIJ_fixture' }),
    );
  });

  it('resolves each DISTINCT place once, however many fixes share it', async () => {
    // 200 fixes at five venues are five resolutions. `placeGroupKey` is
    // `PlaceService`'s own identity, imported, so this is exact rather than a
    // heuristic — and it is what keeps an event and a fix at one venue from
    // becoming two nodes on the map.
    const { stage, placeService } = makeStage({
      rows: [positionRow(1), positionRow(2), positionRow(3)],
    });

    await stage.run({ userId: USER }, [positionId(1), positionId(2), positionId(3)]);

    expect(placeService.findOrCreateForGeocode).toHaveBeenCalledTimes(1);
  });

  it('promotes WITHOUT a hierarchy on a cold cache, and does not call it a failure', async () => {
    const { stage, placeService } = makeStage({ rows: [positionRow(1)], cache: [] });

    const results = await stage.run({ userId: USER }, [positionId(1)]);

    expect(results.get(positionId(1))).toMatchObject({ outcome: 'done' });
    expect(placeService.findOrCreateForGeocode).toHaveBeenCalledWith(
      { userId: USER },
      expect.objectContaining({ placeId: null, components: null }),
    );
  });

  it('survives an unavailable geocode cache rather than failing the slice', async () => {
    const { stage } = makeStage({ rows: [positionRow(1)], failCacheRead: true });

    const results = await stage.run({ userId: USER }, [positionId(1)]);

    expect(results.get(positionId(1))).toMatchObject({ outcome: 'done' });
  });
});

/* ===================================================================== *
 * 6. Failure attribution
 * ===================================================================== */

describe('PositionPlacePromoteStage.run — a failure is attributed, never spread', () => {
  it('fails only the fixes at the venue that could not be resolved', async () => {
    const { stage } = makeStage(
      { rows: [positionRow(1), positionRow(2, { name: 'Other Venue', lat: 1, lng: 2 })] },
      fakePlaceService(async (name) => {
        if (name === 'Other Venue') {
          throw new Error('unique violation');
        }

        return { id: PLACE_ENTITY_ID, created: false };
      }),
    );

    const results = await stage.run({ userId: USER }, [positionId(1), positionId(2)]);

    expect(results.get(positionId(1))).toMatchObject({ outcome: 'done' });
    expect(results.get(positionId(2))).toMatchObject({
      outcome: 'failed',
      reason: 'place_resolve_failed',
    });
  });

  it('fails the whole link write together, because one statement has one outcome', async () => {
    const { stage } = makeStage({ rows: [positionRow(1), positionRow(2)], failLinkWrite: true });

    const results = await stage.run({ userId: USER }, [positionId(1), positionId(2)]);

    for (const id of [positionId(1), positionId(2)]) {
      expect(results.get(id)).toMatchObject({
        outcome: 'failed',
        reason: 'place_link_write_failed',
      });
    }
  });
});
