import fs from 'fs';
import os from 'os';
import path from 'path';

import { GoogleVoiceFileImporter } from '../googlevoice';
// `Relationship` was used below without being imported, which breaks
// `yarn workspace @ci/be-api typecheck` on main and therefore the pre-commit
// gate for every branch. One-line fix, unrelated to this change.
import type { ImportParams, Relationship } from '../timeline';

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

  // processCallLog derives CallType from a FIVE-way alternation
  // (Missed|Placed|Received|Voicemail|Recorded), but the first repair covered
  // only three verbs — so "Voicemail from" and "Recorded call with" were still
  // reaching contact names and content. 2,891 + 188 live rows read
  // "Voicemail call from Voicemail from\nJudy Collins" /
  // "Recorded call from Recorded call with".
  it.each([
    ['Voicemail', 'Voicemail from', 'Voicemail call from Judy Collins'],
    ['Recorded', 'Recorded call with', 'Recorded call from Judy Collins'],
  ])('strips the %s heading too, so it is never doubled', async (type, heading, description) => {
    const item = await callLogFile(
      `<span class="fn">${heading} \nJudy Collins</span>`,
      `Judy Collins - ${type} - 2025-01-15T09_30_00Z.html`,
    );

    expect(item?.metadata?.Contact).toBe('Judy Collins');
    expect(item?.metadata?.Description).toBe(description);

    const content = await item.content.data?.();
    expect(content?.toString('utf8')).toBe(description);
  });

  it('files no contact at all when a Voicemail heading names nobody', async () => {
    const item = await callLogFile(
      '<span class="fn">Voicemail from \n</span>',
      'Voicemail - 2025-01-15T09_30_00Z.html',
    );

    expect(item?.metadata?.Contact).toBeUndefined();
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

  // Regression: metadata.Conversation (the per-file contact/number label —
  // Google Voice exports one HTML file per conversation) was only ever used
  // for display. The generic communications mapper (push/inputs.ts
  // toCommunicationInput) reads metadata.ThreadId, not Conversation, to
  // populate ci.communications.thread_id — so every Google Voice message and
  // call/voicemail record landed with thread_id NULL despite the file itself
  // being a perfectly good per-conversation grouping key. This asserts
  // ThreadId now mirrors Conversation on both paths.
  it('mirrors Conversation onto ThreadId for a properly-named message file', async () => {
    // Use a realistic Google Voice filename ("<contact> - Text - <ts>.html")
    // rather than the shared google-voice-export fixture's conversation-1.html
    // — that name carries no contact prefix at all, so `conversation` is
    // correctly `undefined` there (see the "call-log headings are not names"
    // describe block above for why a filename that names nobody must not be
    // used as one) and would not exercise the mirroring this test is after.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-thread-'));
    fs.mkdirSync(path.join(dir, 'Calls'));
    fs.writeFileSync(
      path.join(dir, 'Calls', 'Jane Doe - Text - 2025-03-01T10_00_00Z.html'),
      `<html><body><div class="message">
         <abbr class="dt" title="2025-03-01T10:00:00.000Z">Mar 1</abbr>:
         <cite class="sender vcard"><a class="tel" href="tel:+15551230099"><span class="fn">Jane Doe</span></a></cite>:
         <q>hi there</q>
       </div></body></html>`,
    );

    const pipeline: EmittedGraph[] = [];
    await new GoogleVoiceFileImporter().fileImport({}, { filename: path.basename(dir), fullPath: dir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const msg = pipeline.find((p) => p.item?.metadata?.Text === 'hi there')!;
    expect(msg).toBeDefined();
    expect(msg.item.metadata!.Conversation).toBe('Jane Doe');
    expect(msg.item.metadata!.ThreadId).toBe('Jane Doe');
  });

  it('mirrors Conversation onto ThreadId for call/voicemail records', async () => {
    const callsExportDir = path.join(FIXTURES_DIR, 'google-voice-export-calls');
    const fiCalls = new GoogleVoiceFileImporter();
    const callsPipeline: EmittedGraph[] = [];
    await fiCalls.fileImport({}, { filename: 'google-voice-export-calls', fullPath: callsExportDir }, {
      pipeline: callsPipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const calls = callsPipeline.filter((p) => p.item?.classification === 'call').map((p) => p.item.metadata);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.ThreadId).toBeDefined();
      expect(c.ThreadId).toBe(c.Conversation);
    }
  });

  // The shared fixture's conversation-1.html has no contact prefix in its
  // filename, so `conversation` is honestly undefined for its messages (see
  // above).
  //
  // An earlier revision asserted ThreadId mirrored that — undefined — on the
  // grounds that a fabricated contact name would be a lie. It would be, but a
  // NULL thread_id is also a lie: it says "this message belongs to no
  // conversation" when the export has one file per conversation and every
  // message in this file demonstrably shares one. `threadKeyFor` resolves it by
  // deriving a SYNTHETIC key from the file, prefixed `googlevoice:file:` so it
  // cannot be mistaken for a contact. Group conversations and unnamed call logs
  // group correctly; nothing claims to know who the counterpart is.
  it('derives a stable synthetic ThreadId when the filename names no contact', async () => {
    const exportDir = path.join(FIXTURES_DIR, 'google-voice-export');
    const fi = new GoogleVoiceFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-voice-export', fullPath: exportDir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const msgs = pipeline
      .filter((p) => p.item?.classification === 'message' && p.item.metadata?.Text !== undefined)
      .map((p) => p.item.metadata);
    expect(msgs.length).toBeGreaterThan(0);
    const threadIds = new Set<unknown>();

    for (const m of msgs) {
      expect(m.Conversation).toBeUndefined();
      expect(m.ThreadId).toEqual(expect.stringContaining('googlevoice:file:'));
      threadIds.add(m.ThreadId);
    }

    // Every message in one conversation file shares one thread — that is the
    // whole point of synthesizing the key rather than leaving it NULL.
    expect(threadIds.size).toBe(1);
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

/*
 * Regression (defect F2): 7,318 Google Voice rows reached ci.communications
 * with from_entity_id NULL and to_entity_ids empty. Every one of them was an
 * image attachment, and every one carried exactly two metadata keys — Source
 * and Attachment. There was nothing for any later linking sweep to read,
 * because this importer staged no participant edges at all and the attachment
 * loop scanned the whole file with no idea which message each <img> came from.
 *
 * An image-only MMS has no <q> body, so the message loop's `continue` skipped
 * it — but its <div class="message"> block still names a sender.
 */
describe('Google Voice participants', () => {
  const importFixture = async (name: string): Promise<EmittedGraph[]> => {
    const pipeline: EmittedGraph[] = [];
    await new GoogleVoiceFileImporter().fileImport(
      {},
      { filename: name, fullPath: path.join(FIXTURES_DIR, name) },
      { pipeline, timeframe: {}, log: () => {} } as unknown as ImportParams,
    );

    return pipeline;
  };

  const importInline = async (html: string, attachments: string[] = []): Promise<EmittedGraph[]> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-part-'));
    fs.mkdirSync(path.join(dir, 'Calls'));
    fs.writeFileSync(
      path.join(dir, 'Phones.vcf'),
      'BEGIN:VCARD\nVERSION:3.0\nFN:My Phone\nTEL:+15551234567\nEND:VCARD\n',
    );
    fs.writeFileSync(path.join(dir, 'Calls', 'Dana Wu - Text - 2025-03-01T12_00_00Z.html'), html);
    for (const a of attachments) {
      fs.writeFileSync(path.join(dir, 'Calls', a), 'jpeg-bytes');
    }

    const pipeline: EmittedGraph[] = [];
    await new GoogleVoiceFileImporter().fileImport({}, { filename: path.basename(dir), fullPath: dir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    return pipeline;
  };

  const participantEdges = (g: EmittedGraph): Relationship[] =>
    (g.edges ?? []).filter((e) => e.relation === 'participant');

  it('attributes an image-only MMS to the sender of the block it came from', async () => {
    const pipeline = await importFixture('google-voice-export');
    const attachment = pipeline.find((p) => p.item?.metadata?.Attachment === 'image')!;
    expect(attachment).toBeDefined();

    // The third block of the fixture is Bob Smith's, and has no <q> body.
    expect(attachment.item.metadata.Sender).toBe('Bob Smith');
    expect(attachment.item.metadata.Direction).toBe('incoming');
    expect(attachment.item.metadata.To).toBe('My Phone');

    const edges = participantEdges(attachment);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.entity?.name).toBe('Bob Smith');
    expect(edges[0].metadata?.direction).toBe('incoming');
    // Identity attribute, or the contact can never be joined to the same
    // number arriving from a vCard (see imessage.ts contactEntity).
    expect(edges[0].to.entity?.attributes).toEqual([
      { name: 'phone', value: '+15559876543', identity: true },
    ]);
  });

  it('stages a participant edge for text messages in both directions', async () => {
    const pipeline = await importFixture('google-voice-export');
    const graphs = pipeline.filter((p) => p.item?.metadata?.Text);

    const inbound = graphs.find((g) => g.item.metadata.Sender === 'Bob Smith')!;
    expect(participantEdges(inbound).map((e) => e.to.entity?.name)).toEqual(['Bob Smith']);
    expect(participantEdges(inbound)[0].metadata?.direction).toBe('incoming');

    // Outbound: the sender is the owner, so the edge names the RECIPIENT.
    const outbound = graphs.find((g) => g.item.metadata.Sender === 'Me')!;
    expect(participantEdges(outbound).map((e) => e.to.entity?.name)).toEqual(['Bob Smith']);
    expect(participantEdges(outbound)[0].metadata?.direction).toBe('outgoing');
  });

  it('attributes an image the owner sent to the owner, not to the contact', async () => {
    const pipeline = await importInline(
      `<html><body>
         <div class="message">
           <abbr class="dt" title="2025-03-01T12:00:00.000Z">Mar 1</abbr>:
           <cite class="sender vcard"><a class="tel" href="tel:+15558887777"><span class="fn">Dana Wu</span></a></cite>:
           <q>look at this</q>
         </div>
         <div class="message">
           <abbr class="dt" title="2025-03-01T12:01:00.000Z">Mar 1</abbr>:
           <cite class="sender vcard"><a class="tel" href="tel:+15551234567"><abbr class="fn" title="">Me</abbr></a></cite>:
           <img src="Dana Wu - Text - 2025-03-01T12_01_00Z-1-1">
         </div>
       </body></html>`,
      ['Dana Wu - Text - 2025-03-01T12_01_00Z-1-1.jpg'],
    );

    const attachment = pipeline.find((p) => p.item?.metadata?.Attachment === 'image')!;
    expect(attachment).toBeDefined();
    expect(attachment.item.metadata.Direction).toBe('outgoing');
    expect(attachment.item.metadata.Sender).toBe('Me');
    expect(attachment.item.metadata.To).toBe('Dana Wu');

    const edges = participantEdges(attachment);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.entity?.name).toBe('Dana Wu');
    expect(edges[0].metadata?.direction).toBe('outgoing');
  });

  it('claims no sender for an image that sits outside every message block', async () => {
    // The filename label names the THREAD, never the author. Filing it as a
    // sender is how this importer previously minted 241 Person entities named
    // after .html files, so an unattributable image stays unattributed.
    const pipeline = await importInline(
      `<html><body>
         <img src="Dana Wu - Text - 2025-03-01T12_02_00Z-1-1">
       </body></html>`,
      ['Dana Wu - Text - 2025-03-01T12_02_00Z-1-1.jpg'],
    );

    const attachment = pipeline.find((p) => p.item?.metadata?.Attachment === 'image')!;
    expect(attachment).toBeDefined();
    expect(attachment.item.metadata.Conversation).toBe('Dana Wu');
    expect(attachment.item.metadata.Sender).toBeUndefined();
    expect(attachment.item.metadata.Direction).toBeUndefined();
    expect(attachment.item.metadata.To).toBeUndefined();
    expect(participantEdges(attachment)).toHaveLength(0);
  });
});
