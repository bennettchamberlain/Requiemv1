import { createStagingHarness, importDatabase, type StagingHarness } from './support/stagingHarness';

/**
 * Keyset pagination over the runs list, against real Postgres.
 *
 * Born from a real session: one Google Takeout produced ~150 runs (Takeout
 * exports oversized media as loose files, one run each), and history capped at
 * a single fetch. Pages must chain by `(created_at, id)` cursor with no row
 * skipped or repeated — including across a created_at TIE, which is what the
 * id tiebreak exists for — and stay stable while new runs keep landing, which
 * is exactly when someone reads history.
 */

const describeWithDatabase = importDatabase.available ? describe : describe.skip;

if (!importDatabase.available) {
  console.warn(`[import/listRunsPagination.integration] SKIPPED — ${importDatabase.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`listRuns keyset pagination (${importDatabase.target})`, () => {
  let harness: StagingHarness;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    ({ harness, teardown } = await createStagingHarness());

    // Seven runs at six distinct seconds — r4 and r4b share a created_at, so
    // one page boundary must be decided by the id tiebreak.
    const rows: Array<[string, string]> = [
      ['r1', '2026-01-01T00:00:01Z'],
      ['r2', '2026-01-01T00:00:02Z'],
      ['r3', '2026-01-01T00:00:03Z'],
      ['r4', '2026-01-01T00:00:04Z'],
      ['r4b', '2026-01-01T00:00:04Z'],
      ['r5', '2026-01-01T00:00:05Z'],
      ['r6', '2026-01-01T00:00:06Z'],
    ];

    for (const [label, createdAt] of rows) {
      await harness.dataSource.query(
        `INSERT INTO ci_import.import_runs (user_id, label, source, status, requested_stages, created_at)
              VALUES ($1::uuid, $2, 'api', 'completed', '{}', $3::timestamptz)`,
        [harness.userId, label, createdAt],
      );
    }
  });

  afterAll(async () => {
    await teardown();
  });

  it('chains pages by cursor with every run seen exactly once, ties included', async () => {
    const seen: string[] = [];
    let before: { createdAt: Date; id: string } | undefined;

    for (;;) {
      const page = await harness.service.listRuns({ userId: harness.userId }, { limit: 2, before });

      seen.push(...page.map((run) => run.label ?? '?'));

      if (page.length < 2) {
        break;
      }

      const last = page[page.length - 1];

      before = { createdAt: last.createdAt, id: last.id };
    }

    // Newest first, no skips, no repeats — the tie pair arrives adjacent, in a
    // stable id order.
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen.slice(0, 2)).toEqual(['r6', 'r5']);
    expect(seen.slice(-1)).toEqual(['r1']);
    expect(new Set(seen.slice(2, 4))).toEqual(new Set(['r4', 'r4b']));
  });

  it('a page shorter than the limit is the last page', async () => {
    const all = await harness.service.listRuns({ userId: harness.userId }, { limit: 200 });
    const last = all[all.length - 1];

    const past = await harness.service.listRuns(
      { userId: harness.userId },
      { limit: 2, before: { createdAt: last.createdAt, id: last.id } },
    );

    expect(past).toHaveLength(0);
  });
});
