import fs from 'fs';
import os from 'os';
import path from 'path';

import type { Graph, ImportParams } from '../timeline';
import { WhatsAppFileImporter } from '../whatsapp';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('WhatsApp datasource', () => {
  it('recognizes directory containing _chat.txt', async () => {
    const root = path.join(FIXTURES_DIR, 'whatsapp-export');
    const fi = new WhatsAppFileImporter();
    const rec = await fi.recognize({}, { filename: 'whatsapp-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('recognizes _chat.txt file directly', async () => {
    const fpath = path.join(FIXTURES_DIR, 'whatsapp-export', '_chat.txt');
    const fi = new WhatsAppFileImporter();
    const rec = await fi.recognize({}, { filename: '_chat.txt', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('imports messages with correct classification', async () => {
    const root = path.join(FIXTURES_DIR, 'whatsapp-export');
    const fi = new WhatsAppFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'whatsapp-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(7);
    expect(pipeline.every((p) => p.item.classification === 'message')).toBe(true);
  });

  it('gives the same message the same id however the archive arrived', async () => {
    // The identity bug: uploading sanitises spaces to underscores while the
    // inbox keeps them, so the SAME export produced two different ids per
    // message and a re-import duplicated the whole chat instead of deduping it.
    const fixture = path.join(FIXTURES_DIR, 'whatsapp-export');
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-arrival-'));

    const idsFrom = async (directoryName: string): Promise<string[]> => {
      const root = path.join(staging, directoryName);
      fs.mkdirSync(root, { recursive: true });
      fs.copyFileSync(path.join(fixture, '_chat.txt'), path.join(root, '_chat.txt'));

      const pipeline: EmittedGraph[] = [];
      await new WhatsAppFileImporter().fileImport({}, { filename: directoryName, fullPath: root }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      return pipeline.map((entry) => entry.item.id as string);
    };

    try {
      // Left: how the inbox presents it. Right: how an upload sanitises it.
      const viaInbox = await idsFrom('WhatsApp Chat - LITA _ Companion Tech Team');
      const viaUpload = await idsFrom('WhatsApp_Chat_-_LITA___Companion_Tech_Team');

      expect(viaInbox).toEqual(viaUpload);
      // And the chat is named after the chat, not after the container: the
      // `WhatsApp Chat -` prefix is not part of anybody's conversation name.
      expect(viaInbox[0]).toContain('LITA Companion Tech Team');
      expect(viaInbox[0]).not.toContain('WhatsApp');
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });

  it('captures sender and message content', async () => {
    const root = path.join(FIXTURES_DIR, 'whatsapp-export');
    const fi = new WhatsAppFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'whatsapp-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const aliceMsg = pipeline.find((p) => p.item.metadata?.Sender === 'Alice');
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg!.item.metadata.Source).toBe('WhatsApp');
    expect(aliceMsg!.item.timestamp).toBeDefined();
  });

  it('filters by timeframe', async () => {
    const fpath = path.join(FIXTURES_DIR, 'whatsapp-export', '_chat.txt');
    const fi = new WhatsAppFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: '_chat.txt', fullPath: fpath }, {
      pipeline,
      timeframe: { since: new Date('2021-01-01T12:00:00Z'), until: new Date('2021-01-02T00:00:00Z') },
      log: () => {},
    } as unknown as ImportParams);

    // Only messages from Jan 1 after midnight UTC should pass
    expect(pipeline.length).toBeLessThan(7);
  });

  it('assigns unique, stable, idempotent ids for same-minute messages', async () => {
    // Android export: HH:MM only (no seconds) — many messages share a clock
    // minute, so the legacy minute-precision timestamp hash collapses them.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-dedup-'));
    fs.writeFileSync(
      path.join(dir, '_chat.txt'),
      '01/01/2021, 08:15 - Alice: first\n' +
        '01/01/2021, 08:15 - Bob: second\n' +
        '01/01/2021, 08:15 - Alice: third\n' +
        '01/01/2021, 08:15 - Bob: fourth\n',
    );

    const run = async () => {
      const fi = new WhatsAppFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: '_chat.txt', fullPath: path.join(dir, '_chat.txt') }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      return pipeline;
    };

    const pipeline = await run();
    expect(pipeline.length).toBe(4);

    const ids = pipeline.map((p) => p.item.id!);
    expect(ids.every((id) => !!id)).toBe(true);
    expect(new Set(ids).size).toBe(pipeline.length);

    // Re-import the same export → identical ids (idempotent).
    const ids2 = (await run()).map((p) => p.item.id!);
    expect(ids2).toEqual(ids);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not merge a header line with no space after the colon into the previous sender', async () => {
    // Real WhatsApp exports emit "[ts] Sender:" with nothing after the colon
    // when the body starts on the next physical line. The old regex required a
    // literal ": " (colon+space), so that header failed to match at all and
    // got appended as a continuation line onto whatever message was still
    // open — silently attributing another sender's text to the wrong person.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-headeronly-'));
    fs.writeFileSync(
      path.join(dir, '_chat.txt'),
      '[1/1/21, 12:00:00 AM] Alice: Hello\n' +
        '[1/1/21, 12:01:00 AM] Bob:\n' +
        "This is Bob's reply\n" +
        '[1/1/21, 12:02:00 AM] Alice: Thanks\n',
    );

    const fi = new WhatsAppFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: '_chat.txt', fullPath: path.join(dir, '_chat.txt') }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(3);
    const [first, second, third] = pipeline.map((p) => p.item);
    expect(first.metadata.Sender).toBe('Alice');
    expect(first.metadata.Text).not.toContain('Bob');
    expect(second.metadata.Sender).toBe('Bob');
    expect(second.metadata.Text).toContain("This is Bob's reply");
    expect(third.metadata.Sender).toBe('Alice');
    expect(third.metadata.Text).toBe('Thanks');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('parses a U+200E-prefixed line as its own message, not merged into the previous sender', async () => {
    // Reproduces the real cross-sender-merge bug: WhatsApp's iOS export
    // prefixes many lines (overwhelmingly attachment/omitted-media
    // announcements) with an invisible U+200E LEFT-TO-RIGHT MARK before the
    // leading '['. Unstripped, IOS_RE's literal '[' anchor fails to match,
    // so the line falls through to the continuation-line branch and gets
    // silently appended onto the PREVIOUS (wrong-sender) message.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-invisible-'));
    const LRM = '‎';
    fs.writeFileSync(
      path.join(dir, '_chat.txt'),
      '[1/1/21, 12:00:00 AM] Alice: Hey, check this out\n' +
        `${LRM}[1/1/21, 12:01:00 AM] Bob: <attached: 00000048-PHOTO.jpg>\n`,
    );

    const pushed: EmittedGraph[] = [];
    const fi = new WhatsAppFileImporter();
    await fi.fileImport({}, { filename: '_chat.txt', fullPath: path.join(dir, '_chat.txt') }, {
      pipeline: { push: (g: Graph) => pushed.push(g as EmittedGraph), drop: () => {} },
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const messages = pushed.filter((g) => g.item.classification === 'message');
    expect(messages.length).toBe(2);

    const aliceMsg = messages.find((g) => g.item.metadata.Sender === 'Alice');
    const bobMsg = messages.find((g) => g.item.metadata.Sender === 'Bob');
    expect(aliceMsg).toBeDefined();
    expect(bobMsg).toBeDefined();

    // Before the fix, Bob's U+200E-prefixed line silently became a raw
    // continuation of Alice's message instead of parsing as its own message
    // with the correct sender/timestamp.
    expect(aliceMsg!.item.metadata.Text).toBe('Hey, check this out');
    expect(aliceMsg!.item.metadata.Text).not.toContain('Bob');
    expect(aliceMsg!.item.metadata.Text).not.toContain('attached');
    expect(bobMsg!.item.metadata.Text).toContain('attached: 00000048-PHOTO.jpg');
    expect(bobMsg!.item.timestamp).toBeDefined();
    expect(bobMsg!.item.timestamp?.toISOString()).not.toBe(aliceMsg!.item.timestamp?.toISOString());

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves an iOS "<attached: X>" reference to a real media item', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-ios-'));
    fs.writeFileSync(path.join(dir, '00000048-PHOTO-2026-05-08-08-35-29.jpg'), Buffer.from('fake-jpg-bytes'));
    fs.writeFileSync(
      path.join(dir, '_chat.txt'),
      '[5/8/26, 8:35:29 AM] Alice: <attached: 00000048-PHOTO-2026-05-08-08-35-29.jpg>\n',
    );

    const pushed: EmittedGraph[] = [];
    const drops: Array<{ reason: string; detail?: string }> = [];
    const fi = new WhatsAppFileImporter();
    await fi.fileImport({}, { filename: '_chat.txt', fullPath: path.join(dir, '_chat.txt') }, {
      pipeline: {
        push: (g: Graph) => pushed.push(g as EmittedGraph),
        drop: (reason: string, detail?: string) => drops.push({ reason, detail }),
      },
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const mediaGraph = pushed.find((g) => g.item.classification === 'media');
    expect(mediaGraph).toBeDefined();
    expect(mediaGraph!.item.content.filename).toBe('00000048-PHOTO-2026-05-08-08-35-29.jpg');
    expect(mediaGraph!.item.content.mediaType).toBe('image/jpeg');
    expect(mediaGraph!.item.intermediateLocation).toBe(
      path.join(dir, '00000048-PHOTO-2026-05-08-08-35-29.jpg'),
    );
    const bytes: Buffer = await mediaGraph!.item.content.data!();
    expect(bytes.toString()).toBe('fake-jpg-bytes');

    // The text message survives alongside the resolved media item — nothing
    // is replaced, the real bytes are just added.
    expect(pushed.some((g) => g.item.classification === 'message')).toBe(true);
    expect(drops.length).toBe(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves an Android "X (file attached)" reference to a real media item', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-android-'));
    fs.writeFileSync(path.join(dir, 'IMG-20260508-WA0001.jpg'), Buffer.from('fake-jpg-bytes'));
    fs.writeFileSync(
      path.join(dir, '_chat.txt'),
      '08/05/2026, 08:36 - Bob: IMG-20260508-WA0001.jpg (file attached)\n',
    );

    const pushed: EmittedGraph[] = [];
    const fi = new WhatsAppFileImporter();
    await fi.fileImport({}, { filename: '_chat.txt', fullPath: path.join(dir, '_chat.txt') }, {
      pipeline: { push: (g: Graph) => pushed.push(g as EmittedGraph), drop: () => {} },
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const mediaGraph = pushed.find((g) => g.item.classification === 'media');
    expect(mediaGraph).toBeDefined();
    expect(mediaGraph!.item.content.filename).toBe('IMG-20260508-WA0001.jpg');
    expect(mediaGraph!.item.content.mediaType).toBe('image/jpeg');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a drop instead of silently losing a reference to a missing attached file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-missing-'));
    fs.writeFileSync(
      path.join(dir, '_chat.txt'),
      '[5/8/26, 8:35:29 AM] Alice: <attached: does-not-exist.jpg>\n',
    );

    const pushed: EmittedGraph[] = [];
    const drops: Array<{ reason: string; detail?: string }> = [];
    const fi = new WhatsAppFileImporter();
    await fi.fileImport({}, { filename: '_chat.txt', fullPath: path.join(dir, '_chat.txt') }, {
      pipeline: {
        push: (g: Graph) => pushed.push(g as EmittedGraph),
        drop: (reason: string, detail?: string) => drops.push({ reason, detail }),
      },
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pushed.some((g) => g.item.classification === 'media')).toBe(false);
    expect(drops).toEqual([{ reason: 'whatsapp_attachment_missing', detail: 'does-not-exist.jpg' }]);
    // The text message is still imported — the attachment loss is reported,
    // not compounded by losing the rest of the message too.
    expect(pushed.some((g) => g.item.classification === 'message')).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('shared-location messages', () => {
    async function importLines(lines: string[]): Promise<EmittedGraph[]> {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-location-'));
      const chatPath = path.join(dir, '_chat.txt');
      fs.writeFileSync(chatPath, lines.join('\n') + '\n');
      const pushed: EmittedGraph[] = [];
      try {
        await new WhatsAppFileImporter().fileImport({}, { filename: '_chat.txt', fullPath: chatPath }, {
          pipeline: pushed,
          timeframe: {},
          log: () => {},
        } as unknown as ImportParams);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }

      return pushed;
    }

    it('classifies a maps.google.com "?q=" link as location and extracts the coordinates', async () => {
      const pushed = await importLines([
        '[1/1/21, 12:00:00 AM] Alice: location: https://maps.google.com/?q=37.7749,-122.4194',
      ]);

      expect(pushed.length).toBe(1);
      const [graph] = pushed;
      expect(graph.item.classification).toBe('location');
      expect(graph.item.location).toEqual({ latitude: 37.7749, longitude: -122.4194 });
      expect(graph.item.metadata.Location).toBe('37.7749, -122.4194');
      // The original transcript text is still preserved in content/metadata.
      expect(graph.item.metadata.Text).toContain('maps.google.com');
    });

    it('extracts coordinates from a "maps/@lat,long" style link too', async () => {
      const pushed = await importLines([
        '[1/1/21, 12:00:00 AM] Bob: https://maps.google.com/maps/@37.77,-122.41,15z',
      ]);

      expect(pushed.length).toBe(1);
      expect(pushed[0].item.classification).toBe('location');
      expect(pushed[0].item.location).toEqual({ latitude: 37.77, longitude: -122.41 });
    });

    it('does not classify a plain-text mention of "location" with no coordinates as a location', async () => {
      const pushed = await importLines([
        '[1/1/21, 12:00:00 AM] Alice: Check out this location: my new place',
      ]);

      expect(pushed.length).toBe(1);
      expect(pushed[0].item.classification).toBe('message');
      expect(pushed[0].item.location).toBeUndefined();
    });

    it('rejects an out-of-range coordinate pair rather than pinning a bogus location', async () => {
      // Latitude 190 fits the regex's digit count but is not a real latitude.
      const pushed = await importLines([
        '[1/1/21, 12:00:00 AM] Alice: location: https://maps.google.com/?q=190.0,45.0',
      ]);

      expect(pushed.length).toBe(1);
      expect(pushed[0].item.classification).toBe('message');
      expect(pushed[0].item.location).toBeUndefined();
    });

    it('links a located message to its sender the same way an ordinary message does', async () => {
      const pushed = await importLines([
        '[1/1/21, 12:00:00 AM] Alice: location: https://maps.google.com/?q=37.7749,-122.4194',
      ]);

      expect(pushed[0].edges).toEqual([
        { relation: 'participant', to: { entity: { type: 'contact', name: 'Alice' } } },
      ]);
    });
  });
});
