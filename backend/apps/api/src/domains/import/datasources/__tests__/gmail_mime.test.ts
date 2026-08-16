import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GmailFileImporter } from '../gmail';
import type { ImportParams, Relationship } from '../timeline';

import type { EmittedGraph } from './support/emitted';
import { metaAttachments } from './support/emitted';

function makeMboxWithAttachment(): string {
  const dir = path.join(os.tmpdir(), 'ci-import-tests');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mime_sample.mbox');
  const boundary = 'XYZBOUNDARY';
  const attachmentData = Buffer.from('hello attachment', 'utf8').toString('base64');
  const msg = `From someone@example.com Fri Jan 03 12:00:00 2025\nSubject: MIME Sample\nDate: Fri, 03 Jan 2025 12:00:00 +0000\nFrom: Alice <alice@example.com>\nTo: Bob <bob@example.com>\nMessage-ID: <id1@example.com>\nContent-Type: multipart/mixed; boundary="${boundary}"\n\n--${boundary}\nContent-Type: multipart/alternative; boundary="ALTBOUND"\n\n--ALTBOUND\nContent-Type: text/plain\n\nPlain body\n--ALTBOUND\nContent-Type: text/html\n\n<html><body><p>HTML body</p></body></html>\n--ALTBOUND--\n--${boundary}\nContent-Type: text/plain; name="note.txt"\nContent-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="note.txt"\n\n${attachmentData}\n--${boundary}--\n`;
  fs.writeFileSync(file, msg, 'utf8');

  return file;
}

describe('Gmail MIME attachments', () => {
  it('extracts text body and carries the attachment on the message (metadata.MediaAttachments)', async () => {
    const mbox = makeMboxWithAttachment();
    const importer = new GmailFileImporter();
    const pipeline: EmittedGraph[] = [];
    await importer.fileImport({}, { filename: path.basename(mbox), fullPath: mbox }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    const graphs = pipeline.filter((g) => g.item);
    const main = graphs.find((g) => g.item?.metadata?.Subject === 'MIME Sample');
    expect(main).toBeTruthy();
    // Attachments ride the communication itself — NOT as sub-item edges, which
    // used to mint a duplicate ci.events row per attachment.
    expect(main?.edges?.some((e: Relationship) => e.relation === 'attachment')).toBeFalsy();
    const atts = metaAttachments(main?.item.metadata.MediaAttachments);
    expect(atts).toHaveLength(1);
    expect(atts[0].filename).toBe('note.txt');
    expect(atts[0].type).toBe('file'); // text/plain is not media
    expect(fs.readFileSync(atts[0].path, 'utf8')).toBe('hello attachment');
  });
});
