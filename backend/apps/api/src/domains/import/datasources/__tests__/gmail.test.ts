import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GmailFileImporter, isHumanCorrespondence } from '../gmail';
import type { DirEntry } from '../registry';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

// Two Message-ID-less messages sharing the SAME Date second. Before the fix
// their item.id fell back to undefined and hashItem collapsed both onto
// (gmail, email, <basename>, <fpath>, ISO(ts)), silently dropping one. The
// content-derived fallback id keeps them distinct.
const COLLIDING =
  'From a@example.com Mon Jan 06 12:00:00 +0000 2025\n' +
  'Date: Mon, 06 Jan 2025 12:00:00 +0000\n' +
  'From: Alice <alice@example.com>\n' +
  'To: Bob <bob@example.com>\n' +
  'Subject: First no-id message\n' +
  '\n' +
  'Body of the first message.\n' +
  '\n' +
  'From b@example.com Mon Jan 06 12:00:00 +0000 2025\n' +
  'Date: Mon, 06 Jan 2025 12:00:00 +0000\n' +
  'From: Carol <carol@example.com>\n' +
  'To: Dave <dave@example.com>\n' +
  'Subject: Second no-id message\n' +
  '\n' +
  'Body of the second message.\n';

function makeParams() {
  const pipeline: EmittedGraph[] = [];
  const params = { pipeline, timeframe: {}, log: () => {} } as unknown as ImportParams;

  return { params, pipeline };
}

async function importIds(file: string): Promise<string[]> {
  const importer = new GmailFileImporter();
  const { params, pipeline } = makeParams();
  await importer.fileImport({}, { filename: path.basename(file), fullPath: file } as DirEntry, params);

  return pipeline.filter((p) => p.item).map((p) => p.item.id!);
}

describe('Gmail dedup-collapse regression', () => {
  it('gives Message-ID-less same-second messages stable, distinct, idempotent ids', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-dedup-'));
    const file = path.join(dir, 'noid.mbox');
    fs.writeFileSync(file, COLLIDING, 'utf8');

    const ids = await importIds(file);
    expect(ids.length).toBe(2);
    // (a) every id truthy
    expect(ids.every((id) => Boolean(id))).toBe(true);
    // (b) ids are unique despite identical timestamp/filename
    expect(new Set(ids).size).toBe(ids.length);

    // (c) re-import yields identical ids (idempotent / content-derived)
    const again = await importIds(file);
    expect(again).toEqual(ids);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('isHumanCorrespondence: Updates-category engagement override', () => {
  const h = (labels: string, extra: Record<string, string> = {}) => ({
    From: 'Store <no-reply@store.example>',
    Subject: 'Your order has shipped',
    'X-Gmail-Labels': labels,
    ...extra,
  });

  it('still drops an un-engaged Updates message', () => {
    expect(isHumanCorrespondence(h('Inbox,Category Updates'))).toBe(false);
  });

  it.each(['Important', 'Starred', 'Opened', 'Category Purchases', 'Category Travel', 'Category Bills'])(
    'keeps an Updates message also labelled %s',
    (signal) => {
      expect(isHumanCorrespondence(h(`Inbox,Category Updates,${signal}`))).toBe(true);
    },
  );

  it('the override wins over list headers and no-reply senders (receipts)', () => {
    // Receipts come from no-reply senders with List-Unsubscribe; the override
    // must KEEP outright, not fall through to the heuristics that re-drop them.
    expect(
      isHumanCorrespondence(
        h('Inbox,Category Updates,Important', { 'List-Unsubscribe': '<mailto:u@store.example>' }),
      ),
    ).toBe(true);
  });

  it('never rescues a message that also carries another bulk label', () => {
    expect(isHumanCorrespondence(h('Category Updates,Important,Spam'))).toBe(false);
    expect(isHumanCorrespondence(h('Category Updates,Opened,Category Promotions'))).toBe(false);
    expect(isHumanCorrespondence(h('Category Updates,Starred,Trash'))).toBe(false);
  });

  it('engagement labels alone do not rescue non-Updates bulk mail', () => {
    expect(isHumanCorrespondence(h('Category Promotions,Important'))).toBe(false);
    expect(isHumanCorrespondence(h('Spam,Opened'))).toBe(false);
  });
});
