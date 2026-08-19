import fs from 'fs';
import os from 'os';
import path from 'path';

import { GoogleVoiceFileImporter } from '../googlevoice';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('call-log headings are not names', () => {
  // 2,025 of 6,673 Person entities on a real import were call-log headings —
  // 900 of them literally "Missed call from" with no name after the phrase.
  // The heading and the contact can share one `fn` span, so taking that span
  // verbatim files the whole heading as somebody's name.
  const callLogFile = async (
    inner: string,
    filename = 'Steven Stone - Missed - 2025-01-15T09_30_00Z.html',
  ): Promise<EmittedGraph['item']> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-call-'));
    // The importer only walks `Calls/`. Writing the fixture at the top level
    // emits nothing, and every assertion below would then pass on `undefined`
    // without exercising a single line of the parser.
    fs.mkdirSync(path.join(dir, 'Calls'));
    fs.writeFileSync(
      path.join(dir, 'Calls', filename),
      `<html><body><div class="haudio">${inner}
         <abbr class="published" title="2025-01-15T09:30:00.000Z">Jan 15</abbr>
       </div></body></html>`,
    );

    const pipeline: EmittedGraph[] = [];
    await new GoogleVoiceFileImporter().fileImport({}, { filename: path.basename(dir), fullPath: dir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const items = pipeline.filter((p) => p.item);

    // Guard against the vacuous pass: no item means every assertion below is
    // checking `undefined` against `undefined`.
    expect(items).toHaveLength(1);

    return items[0].item;
  };

  it('records no contact when neither the markup nor the filename names anyone', async () => {
    const item = await callLogFile(
      '<span class="fn">Missed call from \n</span>',
      'Missed - 2025-01-15T09_30_00Z.html',
    );

    expect(item?.metadata?.Contact).toBeUndefined();
  });

  it('still falls back to the filename label when the markup names nobody', async () => {
    // Google Voice names each call file "<contact> - <Type> - <timestamp>.html",
    // so the filename is a better answer than the heading — and far better than
    // filing "Missed call from" as a person.
    const item = await callLogFile('<span class="fn">Missed call from \n</span>');

    expect(item?.metadata?.Contact).toBe('Steven Stone');
  });

  it('keeps the name when the heading and the name share one span', async () => {
    const item = await callLogFile('<span class="fn">Missed call from \nSteven Stone</span>');

    expect(item?.metadata?.Contact).toBe('Steven Stone');
  });

  it('prefers the name nested inside the tel anchor', async () => {
    const item = await callLogFile(
      '<span class="fn">Received call from <a class="tel" href="tel:+15551230000">' +
        '<span class="fn">Ada Lovelace</span></a></span>',
    );

    expect(item?.metadata?.Contact).toBe('Ada Lovelace');
  });

  it('does not duplicate the heading into the call content or metadata.Description', async () => {
    // The exact real-world corruption: 35,162 live rows read e.g. "Missed
    // call from Missed call from\nSteven Stone" because processCallLog()
    // wraps `contact` (which used to be the whole uncleaned heading+name
    // span) in a SECOND copy of the same "<CallType> call <preposition>"
    // template. Post-fix, `contact` is just the clean name, so the template
    // renders the heading exactly once.
    const item = await callLogFile('<span class="fn">Missed call from \nSteven Stone</span>');

    expect(item?.metadata?.Description).toBe('Missed call from Steven Stone');
    expect(item?.metadata?.Description).not.toMatch(/Missed call from.*Missed call from/s);

    const content = await item.content.data?.();
    expect(content?.toString('utf8')).toBe('Missed call from Steven Stone');
  });
});

describe('Google Voice datasource', () => {
  it('recognizes Google Voice export directory', async () => {
    const exportDir = path.join(FIXTURES_DIR, 'google-voice-export');
    const fi = new GoogleVoiceFileImporter();
    const rec = await fi.recognize({}, { filename: 'google-voice-export', fullPath: exportDir });
    expect(rec.confidence).toBeGreaterThan(0.7);
  });

  it('imports Google Voice conversations', async () => {
    const exportDir = path.join(FIXTURES_DIR, 'google-voice-export');
    const fi = new GoogleVoiceFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-voice-export', fullPath: exportDir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const items = pipeline.filter((p) => p.item);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].item.classification).toBe('message');
    expect(items[0].item.metadata?.Source).toBe('GoogleVoice');
  });

  it('sets direction and recipient for inbound and outbound messages', async () => {
    const exportDir = path.join(FIXTURES_DIR, 'google-voice-export');
    const fi = new GoogleVoiceFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-voice-export', fullPath: exportDir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const msgs = pipeline.filter((p) => p.item).map((p) => p.item.metadata);
    // Inbound: from the contact, recipient is the owner (from Phones.vcf).
    const inbound = msgs.find((m) => m.Sender === 'Bob Smith');
    expect(inbound?.Direction).toBe('incoming');
    expect(inbound?.To).toBe('My Phone');
    // Outbound: sender 'Me', recipient is the conversation contact.
    const outbound = msgs.find((m) => m.Sender === 'Me');
    expect(outbound?.Direction).toBe('outgoing');
    expect(outbound?.To).toBe('Bob Smith');
  });

  it('parses the real send time out of an image attachment filename', async () => {
    // "Bob Smith - Text - 2025-01-15T09_33_00Z-3-1.jpg" — colons swapped for
    // underscores. Previously every image attachment got timestamp: undefined
    // and CI-Server defaulted to ingestion time.
    const exportDir = path.join(FIXTURES_DIR, 'google-voice-export');
    const fi = new GoogleVoiceFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-voice-export', fullPath: exportDir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const attachment = pipeline.find((p) => p.item?.metadata?.Attachment === 'image');
    expect(attachment).toBeDefined();
    expect(attachment!.item.timestamp).toBeInstanceOf(Date);
    expect(attachment!.item.timestamp!.toISOString()).toBe('2025-01-15T09:33:00.000Z');
  });

  it('imports call and voicemail records (haudio markup) as classification "call" instead of dropping them', async () => {
    // Real Google Voice "Missed"/"Placed"/"Voicemail" HTML files use
    // <div class="haudio"> markup with no <q> text body and no <div
    // class="message">, so the SMS/MMS message loop never matches them at
    // all. Before this fix, every one of these files produced zero pipeline
    // items and zero log/drop trace.
    const exportDir = path.join(FIXTURES_DIR, 'google-voice-export-calls');
    const fi = new GoogleVoiceFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-voice-export-calls', fullPath: exportDir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const calls = pipeline.filter((p) => p.item?.classification === 'call').map((p) => p.item);
    expect(calls.length).toBe(3);
    // None of the call/voicemail items should have been silently dropped or
    // misclassified as a generic message.
    expect(pipeline.filter((p) => p.item?.classification === 'message').length).toBe(0);

    const missed = calls.find((c) => c.metadata.CallType === 'Missed');
    expect(missed).toBeDefined();
    expect(missed!.metadata.Direction).toBe('missed');
    expect(missed!.metadata.Contact).toBe('Alice Jones');
    expect(missed!.metadata.Number).toBe('+15551230000');
    expect(missed!.metadata.Duration).toBe(0);
    expect(missed!.timestamp).toBeInstanceOf(Date);
    expect(missed!.timestamp!.toISOString()).toBe('2025-02-01T10:00:00.000Z');

    const placed = calls.find((c) => c.metadata.CallType === 'Placed');
    expect(placed).toBeDefined();
    expect(placed!.metadata.Direction).toBe('outgoing');
    expect(placed!.metadata.Duration).toBe(30);

    const voicemail = calls.find((c) => c.metadata.CallType === 'Voicemail');
    expect(voicemail).toBeDefined();
    expect(voicemail!.metadata.Direction).toBe('incoming');
    expect(voicemail!.metadata.Duration).toBe(75);
    expect(voicemail!.metadata.DurationUnit).toBe('seconds');
    expect(voicemail!.metadata.Transcript).toBe("Hey it's Alice, call me back when you get a chance.");
    expect(voicemail!.metadata.Source).toBe('GoogleVoice');
  });

  it('does not corrupt metadata.To to a stray "\\r" when Phones.vcf is CRLF-terminated with a blank FN line', async () => {
    // A spec-compliant vCard uses CRLF line endings. The owner's own card in
    // this real-world shape has a blank "FN:\r\n" line. The original parser
    // split only on "\n", so the blank FN line parsed as the literal string
    // "\r" — truthy and non-empty — which then won the `this.owner.name ||
    // this.owner.phones?.[0]` fallback over the real phone number, corrupting
    // metadata.To for every incoming message.
    const exportDir = path.join(FIXTURES_DIR, 'google-voice-export-crlf-vcf');
    const fi = new GoogleVoiceFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-voice-export-crlf-vcf', fullPath: exportDir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const inbound = pipeline.find((p) => p.item?.metadata?.Sender === 'Carol Diaz');
    expect(inbound).toBeDefined();
    expect(inbound!.item.metadata.Direction).toBe('incoming');
    expect(inbound!.item.metadata.To).toBe('+15559998888');
    expect(inbound!.item.metadata.To).not.toBe('\r');
  });
});

/**
 * The grouping key, which is NOT the same question as "who is this contact".
 *
 * `Conversation` doubles as the contact name, so it has to stay undefined when
 * the filename names nobody — that is what stopped 241 Person entities being
 * minted from .html filenames. But a thread id has no such constraint, and
 * leaving it undefined too meant 12,962 items across 1,655 "Group
 * Conversation" files (up to 265 messages each) landed with
 * ci.communications.thread_id NULL and no grouping at all.
 */
describe('Google Voice thread ids', () => {
  const importDir = async (dir: string): Promise<EmittedGraph[]> => {
    const pipeline: EmittedGraph[] = [];
    await new GoogleVoiceFileImporter().fileImport({}, { filename: path.basename(dir), fullPath: dir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    return pipeline;
  };

  const writeConversation = (filename: string, body: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-thread-'));
    fs.mkdirSync(path.join(dir, 'Calls'));
    fs.writeFileSync(path.join(dir, 'Calls', filename), `<html><body>${body}</body></html>`);

    return dir;
  };

  const messageBlock = (text: string, name: string): string =>
    `<div class="message">
       <abbr class="dt" title="2025-03-01T10:00:00.000Z">Mar 1</abbr>:
       <cite class="sender vcard"><a class="tel" href="tel:+15551230099"><span class="fn">${name}</span></a></cite>:
       <q>${text}</q>
     </div>`;

  it('threads a contact-named file on the contact, the same value as Conversation', async () => {
    const dir = writeConversation(
      'Jane Doe - Text - 2025-03-01T10_00_00Z.html',
      messageBlock('hi', 'Jane Doe'),
    );

    const msg = (await importDir(dir)).find((p) => p.item?.metadata?.Text === 'hi')!;

    expect(msg.item.metadata.Conversation).toBe('Jane Doe');
    expect(msg.item.metadata.ThreadId).toBe('Jane Doe');
  });

  it('threads a group file on the file, since its name identifies nobody', async () => {
    // Every message in one exported group file is one conversation, so they
    // must share a thread id — while Conversation stays undefined, because the
    // filename is not a person and downstream reads Conversation as one.
    const dir = writeConversation(
      'Group Conversation - 2019-11-11T23_27_25Z.html',
      messageBlock('first', 'Nima Zeighami') + messageBlock('second', 'Shaw Walters'),
    );

    const msgs = (await importDir(dir)).filter((p) => p.item?.metadata?.Text);

    expect(msgs).toHaveLength(2);
    for (const m of msgs) {
      expect(m.item.metadata.Conversation).toBeUndefined();
      expect(m.item.metadata.ThreadId).toBe('googlevoice:file:Group Conversation - 2019-11-11T23_27_25Z');
    }
  });

  it('gives two different group files two different threads', async () => {
    const a = writeConversation('Group Conversation - 2019-11-11T23_27_25Z.html', messageBlock('a', 'Ann'));
    const b = writeConversation('Group Conversation - 2020-08-07T00_05_26Z.html', messageBlock('b', 'Bob'));

    const threadOf = async (dir: string): Promise<unknown> =>
      (await importDir(dir)).find((p) => p.item?.metadata?.Text)!.item.metadata.ThreadId;

    expect(await threadOf(a)).not.toBe(await threadOf(b));
  });

  it('threads an MMS attachment with its parent conversation, not with itself', async () => {
    // The attachment item carried neither Conversation nor ThreadId, so all
    // 7,427 attachment rows on the live database were detached from the
    // conversation they belong to. Its own filename carries a per-message
    // index suffix ("… -1-1.jpg"), which would mint one thread per attachment
    // — the key has to come from the parent HTML file.
    const dir = writeConversation(
      'Group Conversation - 2019-11-11T23_27_25Z.html',
      `${messageBlock('look', 'Ann')}<img src="Group Conversation - 2019-11-11T23_27_25Z-1-1" />`,
    );
    fs.writeFileSync(
      path.join(dir, 'Calls', 'Group Conversation - 2019-11-11T23_27_25Z-1-1.jpg'),
      Buffer.from([0xff, 0xd8, 0xff]),
    );

    const attachment = (await importDir(dir)).find((p) => p.item?.metadata?.Attachment === 'image')!;

    expect(attachment).toBeDefined();
    expect(attachment.item.metadata.ThreadId).toBe(
      'googlevoice:file:Group Conversation - 2019-11-11T23_27_25Z',
    );
  });

  it('threads a call record too, so a call and its texts are not orphaned', async () => {
    const dir = writeConversation(
      'Steven Stone - Missed - 2025-01-15T09_30_00Z.html',
      `<div class="haudio"><span class="fn">Missed call from <a class="tel" href="tel:+15551110000"><span class="fn">Steven Stone</span></a></span>
         <abbr class="published" title="2025-01-15T09:30:00.000Z">Jan 15</abbr></div>`,
    );

    const call = (await importDir(dir)).find((p) => p.item?.classification === 'call')!;

    expect(call.item.metadata.ThreadId).toBe('Steven Stone');
  });
});
