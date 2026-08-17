import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EmailFileImporter } from '../email';
import { receivedDate, mboxFromLineDate } from '../email_date';
import { GmailFileImporter } from '../gmail';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

describe('email_date helpers', () => {
  it('receivedDate reads the timestamp after the LAST semicolon of the first dated Received header', () => {
    const headers = [
      'Received: from 10.217.136.216',
      'Received: from mail5.staples.com (Not Verified[10.4.21.1]) by mx; with SEG id <B6062a4b80002>; Tue, 30 Mar 2021 00:10:32 -0400',
      'Received: from upstream; Mon, 29 Mar 2021 23:59:00 -0400',
    ].join('\n');
    // The first Received carries no date and is skipped; the second (topmost
    // dated hop = final delivery) wins over the third (an earlier hop).
    expect(receivedDate(headers)).toEqual(new Date('2021-03-30T04:10:32.000Z'));
  });

  it('receivedDate returns undefined when no Received header carries a date', () => {
    expect(receivedDate('Subject: hi\nReceived: from a.example.com')).toBeUndefined();
    expect(receivedDate('Subject: hi')).toBeUndefined();
  });

  it('mboxFromLineDate parses the separator line as UTC', () => {
    expect(
      mboxFromLineDate('From support@orders.staples.com Tue Mar 30 04:10:33 2021\nSubject: x\n\nbody'),
    ).toEqual(new Date('2021-03-30T04:10:33.000Z'));
  });

  it('mboxFromLineDate returns undefined for non-mbox input (an .eml has no separator)', () => {
    expect(mboxFromLineDate('From: Alice <a@x.io>\nSubject: x\n\nbody')).toBeUndefined();
    expect(mboxFromLineDate('Subject: x\n\nbody')).toBeUndefined();
  });
});

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-date-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content, 'utf8');

  return f;
}

async function importFile(importer: EmailFileImporter | GmailFileImporter, fpath: string) {
  const pipeline: EmittedGraph[] = [];
  await importer.fileImport({}, { filename: path.basename(fpath), fullPath: fpath }, {
    pipeline,
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  return pipeline.filter((p) => p.item);
}

describe('Date-less messages fall back to Received, then the mbox separator line', () => {
  it('email.ts: no Date but a Received stamp → delivery time (folded Received line)', async () => {
    const mbox =
      'From support@orders.staples.com Tue Mar 30 04:10:33 2021\n' +
      'Received: from lcnppnasv112.staples.com by mail5.staples.com with SEG\n' +
      '\tid <B6062a4b80002>; Tue, 30 Mar 2021 00:10:32 -0400\n' +
      'From: Staples <support@orders.staples.com>\n' +
      'To: Kyle <barankyle@yahoo.com>\n' +
      'Subject: Welcome to Staples.com\n\n' +
      'body\n';
    const items = await importFile(new EmailFileImporter(), tmpFile('nodates.mbox', mbox));
    expect(items).toHaveLength(1);
    expect(items[0].item.timestamp).toEqual(new Date('2021-03-30T04:10:32.000Z'));
  });

  it('email.ts: no Date and no Received (a sent copy) → mbox separator-line date', async () => {
    const mbox =
      'From barankyle@yahoo.com Mon Aug 03 21:16:24 2026\n' +
      'From: Kyle <barankyle@yahoo.com>\n' +
      'To: Alice <alice@example.com>\n' +
      'Subject: Accepted: calendar invite\n\n' +
      'body\n';
    const items = await importFile(new EmailFileImporter(), tmpFile('sentcopy.mbox', mbox));
    expect(items).toHaveLength(1);
    expect(items[0].item.timestamp).toEqual(new Date('2026-08-03T21:16:24.000Z'));
  });

  it('email.ts: an unparseable Date falls through to Received', async () => {
    const mbox =
      'From a@example.com Tue Mar 30 04:10:33 2021\n' +
      'Date: not a real date\n' +
      'Received: from mx; Tue, 30 Mar 2021 00:10:32 -0400\n' +
      'From: A <a@example.com>\n' +
      'Subject: Bad date header\n\n' +
      'body\n';
    const items = await importFile(new EmailFileImporter(), tmpFile('baddate.mbox', mbox));
    expect(items).toHaveLength(1);
    expect(items[0].item.timestamp).toEqual(new Date('2021-03-30T04:10:32.000Z'));
  });

  it('email.ts: an .eml with no date evidence stays undated (no invented time)', async () => {
    const eml = 'From: A <a@example.com>\nTo: B <b@example.com>\nSubject: Nothing datable\n\nbody';
    const items = await importFile(new EmailFileImporter(), tmpFile('undatable.eml', eml));
    expect(items).toHaveLength(1);
    expect(items[0].item.timestamp).toBeUndefined();
  });

  it('gmail.ts: no Date but a Received stamp → delivery time', async () => {
    const mbox =
      'From support@orders.staples.com Tue Mar 30 04:10:33 2021\n' +
      'Received: from mx by mail.google.com; Tue, 30 Mar 2021 00:10:32 -0400\n' +
      'From: Staples <support@orders.staples.com>\n' +
      'To: Kyle <kyle@gmail.com>\n' +
      'X-Gmail-Labels: Category Personal\n' +
      'Subject: Order shipped\n\n' +
      'body\n';
    const items = await importFile(new GmailFileImporter(), tmpFile('nodates.mbox', mbox));
    expect(items).toHaveLength(1);
    expect(items[0].item.timestamp).toEqual(new Date('2021-03-30T04:10:32.000Z'));
  });
});
