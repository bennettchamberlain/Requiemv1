import { DEAD_EVENT_STATUSES, LIVE_EVENT_SQL } from '@ci/domains/memory';

import { eventHappenedSql } from '../eventHappened';

/**
 * This domain's copy of "this event happened". Two other copies exist and must
 * produce the same text: `eventHappenedSql` in
 * `pipeline/stages/enrich/EstimateLocationStage.ts` (which `promote.place`
 * applies) and the one in `maintenance/services/LocationEstimateService.ts`.
 * Neither can be imported from here (the pipeline imports this domain, and
 * `no-cross-domain-internals` forbids reaching past a barrel), so each domain's
 * spec pins its own copy to the same literal, built from the calendar's own
 * `LIVE_EVENT_SQL`. Proven against Postgres, class by class, in
 * `GeocodeBatchListener.integration.spec.ts`.
 */
describe('eventHappenedSql', () => {
  it('states the rule in the text enrich.estimate_location and promote.place state it in', () => {
    // Re-alias `LIVE_EVENT_SQL` rather than retype its status list, so a status
    // added to DEAD_EVENT_STATUSES moves this expectation and the SQL together.
    expect(eventHappenedSql('n')).toBe(
      'COALESCE(n.is_deleted, false) = false ' +
        'AND COALESCE(n.is_predicted, false) = false ' +
        `AND ${LIVE_EVENT_SQL.replace('event.status', 'n.status')} ` +
        "AND COALESCE(n.metadata->>'Canceled', '') <> 'true'",
    );
  });

  it("reads status through the calendar's own vocabulary, re-aliased and nothing else", () => {
    const sql = eventHappenedSql('event');

    expect(sql).toContain(LIVE_EVENT_SQL);
    for (const status of DEAD_EVENT_STATUSES) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  it('puts the alias on every column it reads, and reads the key the Takeout importer writes', () => {
    const sql = eventHappenedSql('x');

    expect(sql).toContain('x.is_deleted');
    expect(sql).toContain('x.is_predicted');
    expect(sql).toContain('x.status');
    expect(sql).toContain("x.metadata->>'Canceled'");
  });

  it('COALESCEs every column, since each is NULL-able in a down migration or absent from metadata', () => {
    const clauses = eventHappenedSql('e').split(' AND ');

    expect(clauses).toHaveLength(4);
    for (const clause of clauses) {
      expect(clause).toMatch(/^COALESCE\(/);
    }
  });

  it('refuses an alias that is not a plain token', () => {
    expect(() => eventHappenedSql('e; DROP TABLE ci.events')).toThrow(/plain/);
    expect(() => eventHappenedSql('e.status')).toThrow(/plain/);
    expect(() => eventHappenedSql('')).toThrow(/plain/);
  });
});
