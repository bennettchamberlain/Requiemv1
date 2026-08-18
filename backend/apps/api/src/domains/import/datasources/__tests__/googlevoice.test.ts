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
  ): Promise<Record<string, unknown> | undefined> => {
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

    // Guard against the vacuous pass: no item means every Contact assertion
    // below is checking `undefined` against `undefined`.
    expect(items).toHaveLength(1);

    return items[0].item.metadata as Record<string, unknown> | undefined;
  };

  it('records no contact when neither the markup nor the filename names anyone', async () => {
    const meta = await callLogFile('<span class="fn">Missed call from \n</span>', 'Missed - 2025-01-15T09_30_00Z.html');

    expect(meta?.Contact).toBeUndefined();
  });

  it('still falls back to the filename label when the markup names nobody', async () => {
    // Google Voice names each call file "<contact> - <Type> - <timestamp>.html",
    // so the filename is a better answer than the heading — and far better than
    // filing "Missed call from" as a person.
    const meta = await callLogFile('<span class="fn">Missed call from \n</span>');

    expect(meta?.Contact).toBe('Steven Stone');
  });

  it('keeps the name when the heading and the name share one span', async () => {
    const meta = await callLogFile('<span class="fn">Missed call from \nSteven Stone</span>');

    expect(meta?.Contact).toBe('Steven Stone');
  });

  it('prefers the name nested inside the tel anchor', async () => {
    const meta = await callLogFile(
      '<span class="fn">Received call from <a class="tel" href="tel:+15551230000">' +
        '<span class="fn">Ada Lovelace</span></a></span>',
    );

    expect(meta?.Contact).toBe('Ada Lovelace');
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
