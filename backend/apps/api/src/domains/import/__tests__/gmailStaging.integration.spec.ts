import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GmailFileImporter } from '../datasources/gmail';
import type { Graph, ImportParams } from '../datasources/timeline';

import { createStagingHarness, importDatabase, type StagingHarness } from './support/stagingHarness';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PARTICIPANTS REACH STAGING AS EDGES, AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The regression this guards: a live full-mbox import of 15,434 items and
 * 12,182 entities recorded ZERO relationships. Participants were emitted as
 * separate top-level entity-only graphs, so nothing ever linked them to their
 * email, and every message arrived downstream with no sender and no recipients.
 * Participants now ride the email graph as `from`/`to`/`cc` edges, and this
 * asserts they survive the whole way into `ci_import.staged_relationships`.
 *
 * Upstream this file also had a "backfills relationships into a legacy DB" case,
 * re-importing over a database that already held orphan entities and no edges.
 * It is NOT restored: it described migrating a long-lived SQLite database
 * written by an older importer, and staging here is run-scoped — deleted with
 * its run — so no such prior state can exist. The equivalent guarantee for
 * ci.* is the push's job, not staging's.
 *
 * The parser-side halves of this file (same-name attachments, the pathological
 * address header) need no database and live in
 * `datasources/__tests__/gmail_relationships.test.ts`.
 */

const describeWithDatabase = importDatabase.available ? describe : describe.skip;

if (!importDatabase.available) {
  console.warn(`[import/gmailStaging.integration] SKIPPED — ${importDatabase.reason}`);
}

jest.setTimeout(60_000);

const BOUNDARY = 'RELBOUNDARY';

/** One human email: display-named From, mixed To (named + bare address), a Cc, one attachment. */
const MBOX =
  `From alice@example.com Fri Jan 03 12:00:00 2025\n` +
  `Subject: Relationship sample\n` +
  `Date: Fri, 03 Jan 2025 12:00:00 +0000\n` +
  `From: Alice <alice@example.com>\n` +
  `To: Bob <bob@example.com>, dave@example.com\n` +
  `Cc: Carol <carol@example.com>\n` +
  `Message-ID: <rel1@example.com>\n` +
  `Content-Type: multipart/mixed; boundary="${BOUNDARY}"\n\n` +
  `--${BOUNDARY}\nContent-Type: text/plain\n\nPlain body\n` +
  `--${BOUNDARY}\nContent-Type: text/plain; name="note.txt"\n` +
  `Content-Transfer-Encoding: base64\n` +
  `Content-Disposition: attachment; filename="note.txt"\n\n` +
  `${Buffer.from('hello attachment', 'utf8').toString('base64')}\n` +
  `--${BOUNDARY}--\n`;

async function importMbox(file: string): Promise<Graph[]> {
  const collected: Graph[] = [];

  await new GmailFileImporter().fileImport({}, { filename: path.basename(file), fullPath: file }, {
    pipeline: { push: (graph: Graph) => collected.push(graph) },
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  return collected;
}

describeWithDatabase(`gmail staging (${importDatabase.target})`, () => {
  let harness: StagingHarness;
  let teardown: () => Promise<void>;
  let mboxDir: string;
  let mboxPath: string;

  beforeAll(async () => {
    ({ harness, teardown } = await createStagingHarness());

    mboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-rel-'));
    mboxPath = path.join(mboxDir, 'rel.mbox');
    fs.writeFileSync(mboxPath, MBOX, 'utf8');
  });

  afterAll(async () => {
    fs.rmSync(mboxDir, { recursive: true, force: true });
    await teardown();
  });

  it('stages every participant as an edge of the email, not as a loose entity', async () => {
    const graphs = await importMbox(mboxPath);

    // Participants are edges of the email graph. A top-level entity-only graph
    // here means the regression is back at the parser.
    expect(graphs.filter((graph) => !graph.item && graph.entity)).toHaveLength(0);

    const { writer, runId } = await harness.writerFor('gmail');

    for (const graph of graphs) {
      writer.push(graph);
    }

    await writer.settled();

    const rows = await harness.dataSource.query<Array<{ relation: string; name: string; type: string }>>(
      `SELECT r.relation, e.name, e.type
         FROM ci_import.staged_relationships r
         JOIN ci_import.staged_entities e ON e.id = r.entity_id
        WHERE r.run_id = $1::uuid
        ORDER BY r.relation, e.name`,
      [runId],
    );

    expect(rows.map((row) => [row.relation, row.name])).toEqual([
      ['cc', 'Carol'],
      ['from', 'Alice'],
      ['to', 'Bob'],
      // A bare address falls back to the address as the name. Without it every
      // nameless participant merges into one blank contact.
      ['to', 'dave@example.com'],
    ]);

    // Handle-bearing participants default to 'contact' via resolveEntityType.
    expect(rows.every((row) => row.type === 'contact')).toBe(true);
  });

  it('stages the attachment as a descriptor on the message, never as its own item', async () => {
    const graphs = await importMbox(mboxPath);
    const { writer, runId } = await harness.writerFor('gmail');

    for (const graph of graphs) {
      writer.push(graph);
    }

    await writer.settled();

    const items = await harness.dataSource.query<Array<{ metadata: Record<string, unknown> }>>(
      `SELECT metadata FROM ci_import.staged_items WHERE run_id = $1::uuid`,
      [runId],
    );

    // One email item. An attachment sub-item would mean the old item↔item shape
    // came back, and with it a second row to push and dedup.
    expect(items).toHaveLength(1);
    expect(items[0].metadata.MediaAttachments).toHaveLength(1);

    const itemToItem = await harness.dataSource.query<Array<{ count: string }>>(
      `SELECT count(*) FROM ci_import.staged_relationships
        WHERE run_id = $1::uuid AND related_item_id IS NOT NULL`,
      [runId],
    );

    expect(itemToItem[0].count).toBe('0');
  });

  it('is idempotent: re-pushing the same mbox stages nothing further', async () => {
    const { writer, runId } = await harness.writerFor('gmail');

    for (const graph of await importMbox(mboxPath)) {
      writer.push(graph);
    }

    await writer.settled();

    const after = writer.totals;

    // The same export pushed twice inside one run — which is what a retried
    // parse looks like — must collapse on the dedup indexes rather than double
    // every participant.
    for (const graph of await importMbox(mboxPath)) {
      writer.push(graph);
    }

    await writer.settled();

    expect(writer.totals.items).toBe(after.items);
    expect(writer.totals.entities).toBe(after.entities);
    expect(writer.totals.relationships).toBe(after.relationships);

    const [{ count }] = await harness.dataSource.query<Array<{ count: string }>>(
      `SELECT count(*) FROM ci_import.staged_relationships WHERE run_id = $1::uuid`,
      [runId],
    );

    expect(count).toBe('4');
  });
});
