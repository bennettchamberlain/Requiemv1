import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GmailFileImporter } from '../gmail';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

/** `streamMbox` is internal to the importer; the tests drive it directly. */
type StreamMboxAccess = { streamMbox(path: string, params: ImportParams): Promise<void> };

// Small synthetic 3-message mbox in real Gmail Takeout shape. Each record
// begins with a "From " separator line at column 0.
const THREE_MESSAGES =
  'From 1234567890123456789@xxx Mon Jan 06 12:00:00 +0000 2025\n' +
  'Date: Mon, 06 Jan 2025 12:00:00 +0000\n' +
  'From: Alice <alice@example.com>\n' +
  'To: Bob <bob@example.com>\n' +
  'Message-ID: <msg-1@mail.example.com>\n' +
  'Subject: First streamed message\n' +
  '\n' +
  'Body of the first message.\n' +
  '\n' +
  'From 2234567890123456789@xxx Mon Jan 06 13:00:00 +0000 2025\n' +
  'Date: Mon, 06 Jan 2025 13:00:00 +0000\n' +
  'From: Carol <carol@example.com>\n' +
  'To: Dave <dave@example.com>\n' +
  'Message-ID: <msg-2@mail.example.com>\n' +
  'Subject: Second streamed message\n' +
  '\n' +
  'Body of the second message.\n' +
  '\n' +
  'From 3234567890123456789@xxx Mon Jan 06 14:00:00 +0000 2025\n' +
  'Date: Mon, 06 Jan 2025 14:00:00 +0000\n' +
  'From: Eve <eve@example.com>\n' +
  'To: Frank <frank@example.com>\n' +
  'Message-ID: <msg-3@mail.example.com>\n' +
  'Subject: Third streamed message\n' +
  '\n' +
  'Body of the third message.\n';

function makeParams() {
  const pipeline: EmittedGraph[] = [];
  const params = { pipeline, timeframe: {}, log: () => {} } as unknown as ImportParams;

  return { params, pipeline };
}

describe('Gmail streaming mbox parsing', () => {
  it('streams a multi-message mbox and emits one item per message', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-stream-'));
    const file = path.join(dir, 'stream.mbox');
    fs.writeFileSync(file, THREE_MESSAGES, 'utf8');

    const importer = new GmailFileImporter();
    const { params, pipeline } = makeParams();
    // Exercise the streaming code path directly (the whole-file path is gated
    // by file size and is covered by the other gmail tests).
    await (importer as unknown as StreamMboxAccess).streamMbox(file, params);

    const items = pipeline.filter((p) => p.item);
    expect(items.length).toBe(3);

    const subjects = items.map((i) => i.item.metadata.Subject).sort();
    expect(subjects).toEqual(['First streamed message', 'Second streamed message', 'Third streamed message']);

    // Classification + Source metadata match the whole-file path.
    expect(items.every((i) => i.item.classification === 'email')).toBe(true);
    expect(items.every((i) => i.item.metadata.Source === 'GmailMbox')).toBe(true);

    // Bodies are decoded correctly per message.
    const first = items.find((i) => i.item.metadata.MessageID === 'msg-1@mail.example.com');
    expect((await first!.item.content.data!()).toString()).toContain('Body of the first message.');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('whole-file and streaming paths produce identical items', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-parity-'));
    const file = path.join(dir, 'parity.mbox');
    fs.writeFileSync(file, THREE_MESSAGES, 'utf8');

    const importer = new GmailFileImporter();

    const whole = makeParams();
    await importer.fileImport({}, { filename: path.basename(file), fullPath: file }, whole.params);
    const wholeSubjects = whole.pipeline
      .filter((p) => p.item)
      .map((p) => p.item.metadata.Subject)
      .sort();

    const streamed = makeParams();
    await (importer as unknown as StreamMboxAccess).streamMbox(file, streamed.params);
    const streamedSubjects = streamed.pipeline
      .filter((p) => p.item)
      .map((p) => p.item.metadata.Subject)
      .sort();

    expect(streamedSubjects).toEqual(wholeSubjects);
    expect(streamedSubjects.length).toBe(3);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
