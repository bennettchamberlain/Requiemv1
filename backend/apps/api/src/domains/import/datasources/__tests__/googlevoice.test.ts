import path from 'path';

import { GoogleVoiceFileImporter } from '../googlevoice';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

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
