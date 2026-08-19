import { buildStageSummary, EMPTY_REASONS, STAGE_SUMMARY_VERSION } from '../stageSummary';

/**
 * Three things this shape promises, and one of them is the whole point.
 *
 *  1. RECONCILIATION — `consumed = produced + dropped`. A stage cannot report a
 *     number it has not accounted for. Everything else here is presentation;
 *     this is the invariant that makes the telemetry trustworthy rather than
 *     decorative, and it is what turns "0 rows" from an ambiguity into an
 *     arithmetic statement.
 *  2. AGGREGATION — one entry per data source, however many times recognition
 *     matched it. The live QA corpus's Google Takeout parse produced 56 entries
 *     for 13 sources; a reader should get 13.
 *  3. AN ANSWER FOR EVERY ZERO — a unit that produced nothing carries an
 *     `emptyReason` from a closed vocabulary. `produced === 0` with no reason
 *     is the exact ambiguity this whole change exists to remove.
 */

describe('buildStageSummary reconciliation', () => {
  it('derives consumed from produced + dropped, so the numbers cannot disagree', () => {
    const summary = buildStageSummary({
      stage: 'parse',
      unitKind: 'data_source',
      units: [{ unit: 'uber', produced: 278, drops: { cancelled_trip: 2 } }],
    });

    expect(summary.consumed).toBe(280);
    expect(summary.produced).toBe(278);
    expect(summary.dropped).toBe(2);
    expect(summary.reconciled).toBe(true);
    expect(summary.consumed).toBe(summary.produced + summary.dropped);
  });

  it('holds the invariant across every unit of a multi-source parse', () => {
    // The shape of a real Takeout pass, with the numbers from the live corpus.
    const summary = buildStageSummary({
      stage: 'parse',
      unitKind: 'data_source',
      units: [
        { unit: 'google_voice', produced: 312_972, drops: { duplicate_in_run: 1 } },
        { unit: 'google_fit', produced: 66_579, drops: { position_without_time: 40 } },
        { unit: 'google_photos', produced: 0 },
        { unit: 'lyft', produced: 0, drops: { cancelled_trip: 2, trip_without_start_time: 79 } },
      ],
      zeroInputReason: 'recognized_not_read',
    });

    expect(summary.reconciled).toBe(true);

    for (const unit of summary.units) {
      expect(unit.consumed).toBe(unit.produced + unit.dropped);
      // And the two ledgers describe the same records, at two grains.
      const bySlug = Object.values(unit.drops).reduce((sum, n) => sum + n, 0);
      const byReason = Object.values(unit.dropsByReason).reduce((sum, n) => sum + (n ?? 0), 0);

      expect(bySlug).toBe(unit.dropped);
      expect(byReason).toBe(unit.dropped);
    }
  });

  it('records a disagreement rather than hiding it, when a stage measures its own input', () => {
    // A stage that genuinely counted what it read passes `consumedOverride`. If
    // that figure and the ledger disagree, the summary SAYS so — it is a defect
    // in the stage, and a telemetry disagreement must never fail a 40GB import
    // that otherwise worked.
    const summary = buildStageSummary({
      stage: 'parse',
      unitKind: 'data_source',
      units: [{ unit: 'gmail', produced: 10, drops: { draft: 2 }, consumedOverride: 20 }],
    });

    expect(summary.consumed).toBe(20);
    expect(summary.produced + summary.dropped).toBe(12);
    expect(summary.reconciled).toBe(false);
  });
});

describe('buildStageSummary aggregation', () => {
  it('collapses repeated recognition passes into one unit per data source', () => {
    // Recognition descends, so one Takeout matched `vcard` at six paths and
    // `google_my_activity` at eight. The old detail carried all fourteen
    // entries in recognition order; answering "how many contacts did this
    // import produce?" meant summing rows by hand.
    const summary = buildStageSummary({
      stage: 'parse',
      unitKind: 'data_source',
      units: [
        { unit: 'vcard', produced: 2, drops: { empty_card: 1 }, path: 'Takeout/Contacts' },
        { unit: 'vcard', produced: 16, path: 'Takeout/Contacts/All' },
        { unit: 'vcard', produced: 648, drops: { empty_card: 4 }, path: 'Contacts' },
        { unit: 'calendar', produced: 686 },
      ],
      zeroInputReason: 'recognized_not_read',
    });

    expect(summary.units.map((unit) => unit.unit)).toEqual(['calendar', 'vcard']);

    const vcard = summary.units.find((unit) => unit.unit === 'vcard');

    expect(vcard).toMatchObject({ produced: 666, dropped: 5, consumed: 671, passes: 3 });
    expect(vcard?.drops).toEqual({ empty_card: 5 });
    expect(vcard?.dropsByReason).toEqual({ empty_record: 5 });
    // The first path is kept, because a false-positive recognition is always a
    // "what did it match?" question.
    expect(vcard?.path).toBe('Takeout/Contacts');
  });

  it('does not call a source empty because one of its passes was', () => {
    // Five vcard paths yielding nothing and a sixth yielding 325 rows is a
    // source that worked. The per-unit empty reason is re-derived over the
    // MERGED totals, not carried over from the first pass.
    const summary = buildStageSummary({
      stage: 'parse',
      unitKind: 'data_source',
      units: [
        { unit: 'vcard', produced: 0 },
        { unit: 'vcard', produced: 0 },
        { unit: 'vcard', produced: 325 },
      ],
      zeroInputReason: 'recognized_not_read',
    });

    expect(summary.units[0]).toMatchObject({ unit: 'vcard', produced: 325, passes: 3 });
    expect(summary.units[0].emptyReason).toBeUndefined();
  });

  it('sorts the largest producer first, so a run names what it is mostly about', () => {
    const summary = buildStageSummary({
      stage: 'push',
      unitKind: 'data_source',
      units: [
        { unit: 'calendar', produced: 686 },
        { unit: 'google_voice', produced: 309_689 },
        { unit: 'google_fit', produced: 66_579 },
      ],
    });

    expect(summary.units.map((unit) => unit.unit)).toEqual(['google_voice', 'google_fit', 'calendar']);
  });
});

describe('buildStageSummary: a stage that produces nothing says why', () => {
  it('distinguishes a parser that read nothing from one that dropped everything', () => {
    // The pair of cases from the live corpus, side by side. `google_photos`
    // matched a real Google Takeout, ran, and emitted neither a row nor a drop
    // — which before this was indistinguishable from a parser that was never
    // tried. `lyft` also produced nothing, and its ledger names all 81 records
    // it discarded.
    const summary = buildStageSummary({
      stage: 'parse',
      unitKind: 'data_source',
      units: [
        { unit: 'google_photos', produced: 0 },
        { unit: 'lyft', produced: 0, drops: { cancelled_trip: 2, trip_without_start_time: 79 } },
      ],
      zeroInputReason: 'recognized_not_read',
    });

    const photos = summary.units.find((unit) => unit.unit === 'google_photos');
    const lyft = summary.units.find((unit) => unit.unit === 'lyft');

    expect(photos).toMatchObject({
      consumed: 0,
      produced: 0,
      dropped: 0,
      emptyReason: 'recognized_not_read',
    });
    expect(lyft).toMatchObject({ consumed: 81, produced: 0, dropped: 81, emptyReason: 'all_dropped' });
    expect(lyft?.dropsByReason).toEqual({ cancelled: 2, no_timestamp: 79 });
  });

  it('calls a re-import what it is, rather than "everything was dropped"', () => {
    // A push whose destinations already held every record legitimately writes
    // zero rows. Reading that as a total loss is the confusion the push
    // stage's single `deduped` counter caused, and it is why this reason is
    // checked before `all_dropped`.
    const summary = buildStageSummary({
      stage: 'push',
      unitKind: 'data_source',
      units: [{ unit: 'amazon', produced: 0, drops: { already_in_destination: 2_777 } }],
    });

    expect(summary.emptyReason).toBe('all_already_present');
    expect(summary.gaps).toEqual([]);
  });

  it('separates a row that was routed nowhere from one that was already there', () => {
    // The third outcome hiding inside `deduped`: `destinationsFor` returned []
    // — an Amazon subscription fee line — so the row was never offered to
    // anything. It is not in ci.*, and it must not be counted as though it is.
    const summary = buildStageSummary({
      stage: 'push',
      unitKind: 'data_source',
      units: [
        {
          unit: 'amazon',
          produced: 2_760,
          drops: { already_in_destination: 17, no_destination: 43, row_push_failed: 1 },
        },
      ],
    });

    expect(summary.dropsByReason).toEqual({ already_present: 17, no_destination: 43, row_failed: 1 });
    expect(summary.gaps).toEqual([
      { reason: 'no_destination', count: 43 },
      { reason: 'row_failed', count: 1 },
    ]);
    expect(summary.reconciled).toBe(true);
  });

  it('gives a failed unit the reason "failed" and keeps what it was doing', () => {
    const summary = buildStageSummary({
      stage: 'parse',
      unitKind: 'data_source',
      units: [{ unit: 'broken', produced: 0, error: 'parse [dataSource=broken file=Mail/x.mbox] ENOENT' }],
      zeroInputReason: 'recognized_not_read',
    });

    expect(summary.units[0]).toMatchObject({ emptyReason: 'failed' });
    expect(summary.units[0].error).toContain('Mail/x.mbox');
  });

  it('never leaves a zero-yield unit without a reason', () => {
    // The property, rather than a case: every way of producing nothing must
    // land on one of the declared reasons.
    const summary = buildStageSummary({
      stage: 'media',
      unitKind: 'store',
      units: [
        { unit: 'a', produced: 0 },
        { unit: 'b', produced: 0, drops: { media_upload_failed: 4 } },
        { unit: 'c', produced: 0, error: 'boom' },
      ],
      zeroInputReason: 'no_input',
    });

    for (const unit of summary.units) {
      expect(unit.emptyReason).toBeDefined();
      expect(EMPTY_REASONS).toContain(unit.emptyReason);
    }

    expect(summary.emptyReason).toBeDefined();
  });
});

describe('the persisted shape', () => {
  it('is versioned and self-describing, because agents parse it', () => {
    const summary = buildStageSummary({
      stage: 'unpack',
      unitKind: 'archive',
      units: [{ unit: 'takeout.zip', produced: 1 }],
    });

    expect(summary.v).toBe(STAGE_SUMMARY_VERSION);
    expect(summary.stage).toBe('unpack');
    // A reader that finds this JSON detached from its row still knows what the
    // entries in `units` ARE — files, sources, tables — without a lookup.
    expect(summary.unitKind).toBe('archive');
  });

  it('omits optional keys entirely rather than writing nulls into the JSONB', () => {
    const summary = buildStageSummary({
      stage: 'push',
      unitKind: 'data_source',
      units: [{ unit: 'amazon', produced: 5 }],
    });

    expect(Object.keys(summary)).not.toContain('samples');
    expect(Object.keys(summary)).not.toContain('failure');
    expect(Object.keys(summary)).not.toContain('emptyReason');
  });
});
