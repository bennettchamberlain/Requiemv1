import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { COLLAPSED_DISTINCT_PATH } from '../staging/StagedWriter';

import { createStagingHarness, importDatabase, type StagingHarness } from './support/stagingHarness';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO FILES CALLED note.txt MUST STAGE AS TWO ROWS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The reproduction, against real Postgres and real files on disk, of the
 * within-run dedup swallowing data.
 *
 * `hashItem` fell back to `sha1(dataSource, classification, filename,
 * timestamp)`, and for a record with no parser id, no timestamp and no
 * coordinates that degenerates to `sha1(source, classification, BASENAME)`.
 * `StagedWriter` then `ON CONFLICT … DO NOTHING`s the loser. Run live on a
 * two-file unit — `AliceThread/note.txt` (25 bytes) and `BobThread/note.txt`
 * (29 bytes) — the parse reported `{"items":1,"itemsDeduped":1}` and only the
 * 25-byte file ever reached `ci.files`. The other was consumed by the unpack's
 * rename and deleted with the run's scratch tree.
 *
 * The exposure is not marginal: 79,806 of 80,067 `generic` rows in a real 462k
 * run carry no `occurred_at`, and 24 parsers assign no `item.id`.
 *
 * These specs need a real database because the collapse IS the unique index —
 * `staged_items_run_source_hash_uniq` — and a mock would agree with whatever
 * the spec author believed about it.
 */

const describeWithDatabase = importDatabase.available ? describe : describe.skip;

if (!importDatabase.available) {
  console.warn(`[import/stagedIdentity.integration] SKIPPED — ${importDatabase.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`staged item identity (${importDatabase.target})`, () => {
  let harness: StagingHarness;
  let teardown: () => Promise<void>;
  let tree: string;

  beforeAll(async () => {
    ({ harness, teardown } = await createStagingHarness());
    tree = await mkdtemp(path.join(os.tmpdir(), 'ci-staged-identity-'));
  });

  afterAll(async () => {
    await teardown();
  });

  /** A note with real bytes on disk, the way an unpacked tree presents one. */
  async function seedNote(folder: string, body: string): Promise<string> {
    const dir = path.join(tree, folder);

    await mkdir(dir, { recursive: true });

    const filePath = path.join(dir, 'note.txt');

    await writeFile(filePath, body);

    return filePath;
  }

  async function stagedRows(runId: string) {
    return harness.dataSource.query<
      Array<{ intermediate_location: string; content_sha256: string | null; size_bytes: string | null }>
    >(
      `SELECT intermediate_location, content_sha256, size_bytes
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid
        ORDER BY intermediate_location`,
      [runId],
    );
  }

  it('stages both same-named notes, and records what told them apart', async () => {
    const { writer, runId } = await harness.writerFor('generic');

    // 25 and 29 bytes, exactly the pair that reproduced live.
    const alice = await seedNote('AliceThread', 'Alice wrote this one down.');
    const bob = await seedNote('BobThread', 'Bob wrote a different note!!!');

    for (const filePath of [alice, bob]) {
      writer.push({
        item: {
          classification: 'note',
          content: { filename: 'note.txt' },
          intermediateLocation: filePath,
        },
      });
    }

    await writer.settled();

    const rows = await stagedRows(runId);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.intermediate_location)).toEqual([alice, bob]);

    // The digest column exists with an index and was never written by anything;
    // it is now populated for exactly the rows whose identity depends on it.
    expect(rows[0].content_sha256).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(rows[1].content_sha256).not.toBe(rows[0].content_sha256);
    expect(rows.map((row) => Number(row.size_bytes))).toEqual([26, 29]);

    expect(writer.totals.items).toBe(2);
    expect(writer.totals.itemsDeduped).toBe(0);
  });

  it('still collapses one file replicated into two album folders', async () => {
    const { writer, runId } = await harness.writerFor('google_photos');

    // Identical bytes, two paths, no timestamp — the Takeout album case for a
    // photo whose EXIF carried no capture time. The path-only fix would stage
    // this twice; the content digest is what keeps it one row.
    const first = await seedNote('European Vacation', 'the same picture');
    const second = await seedNote('Photos from 2012', 'the same picture');

    for (const filePath of [first, second]) {
      writer.push({
        item: {
          classification: 'photo',
          content: { filename: 'note.txt' },
          intermediateLocation: filePath,
        },
      });
    }

    await writer.settled();

    expect(await stagedRows(runId)).toHaveLength(1);
    expect(writer.totals.items).toBe(1);
    expect(writer.totals.itemsDeduped).toBe(1);
    // A PROVEN duplicate — same digest — so nothing is reported as dropped.
    expect(writer.totals.drops[COLLAPSED_DISTINCT_PATH]).toBeUndefined();
  });

  it('reports a collapse it could not prove in the drop ledger, not just as a dedup count', async () => {
    const { writer, runId } = await harness.writerFor('paypal');

    // Two records with the parser's OWN id, colliding. Nothing on disk to
    // fingerprint, so the writer cannot show they are the same thing — which is
    // exactly the case that used to vanish into `itemsDeduped`.
    for (const location of ['statements/january.csv', 'statements/february.csv']) {
      writer.push({
        item: { id: 'paypal-txn-1', classification: 'transaction', intermediateLocation: location },
      });
    }

    await writer.settled();

    expect(await stagedRows(runId)).toHaveLength(1);
    expect(writer.totals.itemsDeduped).toBe(1);
    expect(writer.totals.drops[COLLAPSED_DISTINCT_PATH]).toBe(1);
  });
});
