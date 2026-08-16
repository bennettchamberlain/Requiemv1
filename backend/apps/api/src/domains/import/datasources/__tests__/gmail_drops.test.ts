import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GmailFileImporter } from '../gmail';
import type { DirEntry } from '../registry';
import type { Graph, ImportParams } from '../timeline';

/** `streamMbox` is internal to the importer; the tests drive it directly. */
type StreamMboxAccess = { streamMbox(path: string, params: ImportParams): Promise<void> };

/*
 * Silent-drop accounting regression (the "89,514 collected → 15,434 inserted,
 * drops={dedup:62}" mystery on a 5.3GB Takeout mbox).
 *
 * parseMessage used to `return` without reporting on three paths — non-message
 * chunks, timeframe misses, and the human-correspondence bulk filter — so ~90%
 * of a real archive's messages vanished from the job's drop ledger. Every mbox
 * record must now be accounted for: kept item graphs + drop ledger = records.
 */

const MBOX =
  // 1) human correspondence → kept
  'From alice@example.com Mon Jan 06 12:00:00 +0000 2025\n' +
  'Date: Mon, 06 Jan 2025 12:00:00 +0000\n' +
  'From: Alice <alice@example.com>\n' +
  'To: Bob <bob@example.com>\n' +
  'Subject: Lunch tomorrow?\n' +
  'Message-ID: <human-1@example.com>\n' +
  '\n' +
  'Sure, noon works.\n' +
  '\n' +
  // 2) newsletter (List-Unsubscribe) → bulk_filtered
  'From news@shop.example Mon Jan 06 12:01:00 +0000 2025\n' +
  'Date: Mon, 06 Jan 2025 12:01:00 +0000\n' +
  'From: Shop News <news@shop.example>\n' +
  'To: Bob <bob@example.com>\n' +
  'Subject: 50% off everything!\n' +
  'List-Unsubscribe: <mailto:unsub@shop.example>\n' +
  'Message-ID: <promo-1@shop.example>\n' +
  '\n' +
  'Deals deals deals.\n' +
  '\n' +
  // 3) Gmail-labelled spam → bulk_filtered
  'From spam@bad.example Mon Jan 06 12:02:00 +0000 2025\n' +
  'Date: Mon, 06 Jan 2025 12:02:00 +0000\n' +
  'From: Totally Legit <spam@bad.example>\n' +
  'To: Bob <bob@example.com>\n' +
  'Subject: You won\n' +
  'X-Gmail-Labels: Spam\n' +
  'Message-ID: <spam-1@bad.example>\n' +
  '\n' +
  'Claim your prize.\n' +
  '\n' +
  // 4) malformed record: headers only, no blank-line body separator → non_message
  'From noise@example.com Mon Jan 06 12:03:00 +0000 2025\n' +
  'X-Junk: header only, never a body\n';

interface Captured {
  graphs: Graph[];
  drops: Record<string, number>;
  params: ImportParams;
}

function makeParams(timeframe?: { since?: Date; until?: Date }): Captured {
  const graphs: Graph[] = [];
  const drops: Record<string, number> = {};
  const params = {
    options: {},
    timeframe,
    pipeline: {
      push: (g: Graph) => {
        graphs.push(g);
      },
      drop: (reason: string) => {
        drops[reason] = (drops[reason] ?? 0) + 1;
      },
    },
    log: () => {},
  } as unknown as ImportParams;

  return { graphs, drops, params };
}

function writeMbox(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-drops-'));
  const file = path.join(dir, 'takeout.mbox');
  fs.writeFileSync(file, MBOX, 'utf8');

  return { dir, file };
}

const RECORDS = 4; // "^From " separator lines in MBOX

describe('Gmail silent-drop accounting', () => {
  let dir: string;
  let file: string;
  const savedEnv = process.env.CI_GMAIL_INCLUDE_BULK;

  beforeEach(() => {
    delete process.env.CI_GMAIL_INCLUDE_BULK;
    ({ dir, file } = writeMbox());
  });
  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.CI_GMAIL_INCLUDE_BULK;
    } else {
      process.env.CI_GMAIL_INCLUDE_BULK = savedEnv;
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports every filtered/malformed record to the drop ledger (whole-file path)', async () => {
    const { graphs, drops, params } = makeParams();
    await new GmailFileImporter().fileImport(
      {},
      { filename: path.basename(file), fullPath: file } as DirEntry,
      params,
    );

    const itemGraphs = graphs.filter((g) => g.item);
    expect(itemGraphs.length).toBe(1); // only the human email survives
    expect(itemGraphs[0].item!.metadata?.Subject).toBe('Lunch tomorrow?');

    expect(drops).toEqual({ bulk_filtered: 2, non_message: 1 });
    // Full accounting: nothing vanishes silently.
    const dropped = Object.values(drops).reduce((a, b) => a + b, 0);
    expect(itemGraphs.length + dropped).toBe(RECORDS);
  });

  it('reports timeframe misses as outside_timeframe', async () => {
    const { graphs, drops, params } = makeParams({ until: new Date('2020-01-01T00:00:00Z') });
    await new GmailFileImporter().fileImport(
      {},
      { filename: path.basename(file), fullPath: file } as DirEntry,
      params,
    );

    expect(graphs.filter((g) => g.item).length).toBe(0);
    // timeframe check runs before the bulk filter, so all dated records fall there
    expect(drops).toEqual({ outside_timeframe: 3, non_message: 1 });
  });

  it('keeps the ledger identical on the streaming (large-file) path', async () => {
    const { graphs, drops, params } = makeParams();
    // streamMbox is the >256MB code path; drive it directly for parity.
    await (new GmailFileImporter() as unknown as StreamMboxAccess).streamMbox(file, params);

    expect(graphs.filter((g) => g.item).length).toBe(1);
    expect(drops).toEqual({ bulk_filtered: 2, non_message: 1 });
  });

  it('CI_GMAIL_INCLUDE_BULK=1 keeps bulk mail and records no bulk_filtered drops', async () => {
    process.env.CI_GMAIL_INCLUDE_BULK = '1';
    const { graphs, drops, params } = makeParams();
    await new GmailFileImporter().fileImport(
      {},
      { filename: path.basename(file), fullPath: file } as DirEntry,
      params,
    );

    expect(graphs.filter((g) => g.item).length).toBe(3);
    expect(drops).toEqual({ non_message: 1 });
  });
});
