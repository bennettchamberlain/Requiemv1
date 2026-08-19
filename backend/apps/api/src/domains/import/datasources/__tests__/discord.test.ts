import fs from 'fs';
import os from 'os';
import path from 'path';

import { DiscordFileImporter } from '../discord';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';
import { metaText } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const messages = (pipeline: EmittedGraph[]) => pipeline.filter((p) => p.item.classification === 'message');

describe('Discord datasource', () => {
  it('recognizes a Discord export directory with messages/<channel>/messages.csv', async () => {
    const root = path.join(FIXTURES_DIR, 'discord-export');
    const fi = new DiscordFileImporter();
    const rec = await fi.recognize({}, { filename: 'discord-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('recognizes a lone messages.csv with the Discord header', async () => {
    const fpath = path.join(FIXTURES_DIR, 'discord-export', 'messages', 'c123456', 'messages.csv');
    const fi = new DiscordFileImporter();
    const rec = await fi.recognize({}, { filename: 'messages.csv', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('imports messages with channel name and quoted-comma contents intact', async () => {
    const root = path.join(FIXTURES_DIR, 'discord-export');
    const fi = new DiscordFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'discord-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const msgs = messages(pipeline);
    expect(msgs.length).toBe(2);
    expect(pipeline.every((p) => p.item.metadata.Source === 'Discord')).toBe(true);
    expect(pipeline.every((p) => p.item.metadata.Conversation === 'general')).toBe(true);
    expect(msgs[0].item.timestamp).toBeDefined();

    const contents = await msgs[0].item.content.data!();
    expect(contents.toString()).toBe('Hello there, how are you?');
    expect(msgs[1].item.metadata.Attachments).toContain('file.png');
  });

  it('sets outbound direction and no To for guild channels (a channel is a place, not people)', async () => {
    const root = path.join(FIXTURES_DIR, 'discord-export');
    const fi = new DiscordFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'discord-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const msgs = messages(pipeline);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((p) => p.item.metadata.Direction === 'outbound')).toBe(true);
    expect(msgs.every((p) => p.item.metadata.To === undefined)).toBe(true);
    expect(msgs[0].item.metadata.Conversation).toBe('general');
    // No Account/user.json in the old-format fixture → no From to stamp.
    expect(msgs.every((p) => p.item.metadata.From === undefined)).toBe(true);
  });

  // The links stay on the message; the push turns them into ci.content rows and
  // links them back through the attachments column (mapping.ts + graphql.ts).
  it('carries the attachment links on the message they were posted with', async () => {
    const root = path.join(FIXTURES_DIR, 'discord-export');
    const fi = new DiscordFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'discord-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const withLinks = messages(pipeline).filter((p) => p.item.metadata.Attachments);
    expect(withLinks.length).toBe(1);
    expect(withLinks[0].item.id).toBe('discord:1002');
    expect(withLinks[0].item.metadata.Attachments).toBe(
      'https://cdn.discordapp.com/attachments/1/2/file.png',
    );
  });

  describe('JSON package format (current Discord exports)', () => {
    const root = path.join(FIXTURES_DIR, 'discord-export-json');
    const run = async () => {
      const pipeline: EmittedGraph[] = [];
      await new DiscordFileImporter().fileImport({}, { filename: 'discord-export-json', fullPath: root }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      return pipeline;
    };

    it('recognizes a package root with Messages/<channel>/messages.json (capital M)', async () => {
      const rec = await new DiscordFileImporter().recognize(
        {},
        { filename: 'discord-export-json', fullPath: root },
      );
      expect(rec.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('recognizes a lone messages.json', async () => {
      const fpath = path.join(root, 'Messages', 'c1082151271110295552', 'messages.json');
      const rec = await new DiscordFileImporter().recognize(
        {},
        { filename: 'messages.json', fullPath: fpath },
      );
      expect(rec.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('imports messages, skipping empty contents', async () => {
      const pipeline = await run();
      expect(messages(pipeline).length).toBe(5);
      expect(pipeline.every((p) => p.item.metadata.Source === 'Discord')).toBe(true);
      const attach = pipeline.find((p) => p.item.metadata.Attachments);
      expect(attach!.item.metadata.Attachments).toContain('pic.png');
    });

    it('names channels from Messages/index.json, including DMs without channel.json name', async () => {
      const pipeline = await run();
      const conversations = new Set(pipeline.map((p) => p.item.metadata.Conversation));
      expect(conversations).toContain('Direct Message with someuser#0000');
      expect(conversations).toContain('general in We Survived Napster');
    });

    it('ignores the literal "None" name index.json uses for unnamed channels', async () => {
      const pipeline = await run();
      const conversations = new Set(pipeline.map((p) => p.item.metadata.Conversation));
      expect(conversations).not.toContain('None');
      expect(conversations).toContain('Channel 555000000000000001');
    });

    it('resolves 1:1 DM recipients to the handle from index.json, stripping the #<n> discriminator', async () => {
      const pipeline = await run();
      const dm = pipeline.filter((p) => p.item.metadata.Conversation === 'Direct Message with someuser#0000');
      expect(dm.length).toBeGreaterThan(0);
      expect(dm.every((p) => Array.isArray(p.item.metadata.To))).toBe(true);
      expect(dm[0].item.metadata.To).toEqual(['someuser']);
    });

    it('falls back to the Account/user.json friends map when the DM index name is unusable', async () => {
      const pipeline = await run();
      const dm = pipeline.filter((p) => p.item.metadata.Conversation === 'Channel 555000000000000001');
      expect(dm.length).toBeGreaterThan(0);
      expect(dm[0].item.metadata.To).toEqual(['Friend Guy']);
    });

    it('group DMs list resolved friends only — bare ids are omitted, nickname wins', async () => {
      const pipeline = await run();
      const gdm = pipeline.filter((p) => p.item.metadata.Conversation === 'Unknown channel');
      expect(gdm.length).toBeGreaterThan(0);
      // Recipients were [self, friend, nicknamed friend, stranger 999…]: the
      // stranger id and self never appear.
      expect(gdm[0].item.metadata.To).toEqual(['Friend Guy', 'Nicky']);
    });

    it('guild channels get no To at all', async () => {
      const pipeline = await run();
      const guild = pipeline.filter((p) => p.item.metadata.Conversation === 'general in We Survived Napster');
      expect(guild.length).toBeGreaterThan(0);
      expect(guild.every((p) => p.item.metadata.To === undefined)).toBe(true);
    });

    it('never sets a Subject — chat messages have no natural subject line', async () => {
      const pipeline = await run();
      expect(pipeline.length).toBeGreaterThan(0);
      expect(pipeline.every((p) => p.item.metadata.Subject === undefined)).toBe(true);
    });

    it('stamps From on every message with the owner name from Account/user.json', async () => {
      const pipeline = await run();
      const msgs = messages(pipeline);
      expect(msgs.length).toBeGreaterThan(0);
      expect(msgs.every((p) => p.item.metadata.From === 'Kyle Baran')).toBe(true);
    });

    it('preserves full snowflake IDs (no float precision loss) and parses zone-less timestamps as UTC', async () => {
      const pipeline = await run();
      const ids = pipeline.map((p) => p.item.id!);
      expect(ids).toContain('discord:1004447319112036352');
      expect(ids).toContain('discord:1004447319112036353');
      expect(new Set(ids).size).toBe(ids.length);
      const dm = pipeline.find((p) => p.item.id === 'discord:1004447319112036352');
      expect(dm!.item.timestamp!.toISOString()).toBe('2022-08-03T17:55:02.000Z');
    });
  });

  // An image posted with no caption used to be dropped entirely by the
  // empty-Contents guard, taking its upload with it.
  it('keeps an attachment-only message, with empty content bytes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-attach-'));
    const chan = path.join(dir, 'messages', 'c123456');
    fs.mkdirSync(chan, { recursive: true });
    const sign =
      '?ex=0&is=6a3ef3a9&hm=ae13d7420d21b6ad95cf687355e126da2dbc27f149b256428153614da27e6b07&uc=dp&';
    const cdn = 'https://cdn.discordapp.com/attachments/697126491812790292/768724455098679306';
    fs.writeFileSync(
      path.join(chan, 'messages.csv'),
      'ID,Timestamp,Contents,Attachments\n' +
        `2001,2024-01-01T12:00:00.000+00:00,two files,"${cdn}/clip.mp4${sign} ${cdn}/values.yaml${sign}"\n` +
        `2002,2024-01-02T12:00:00.000+00:00,,${cdn}/shot.png${sign}\n` +
        '2003,2024-01-03T12:00:00.000+00:00,,\n',
    );
    const pipeline: EmittedGraph[] = [];
    await new DiscordFileImporter().fileImport({}, { filename: 'x', fullPath: dir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    // 2002 (attachment, no text) survives; 2003 (neither) is still dropped.
    expect(pipeline.map((p) => p.item.id!)).toEqual(['discord:2001', 'discord:2002']);
    expect(pipeline.every((p) => p.item.classification === 'message')).toBe(true);

    const only = pipeline[1].item;
    expect((await only.content!.data!()).toString()).toBe('');
    expect(only.metadata.Text).toBeUndefined();
    expect(only.metadata.Attachments).toContain('shot.png');
    // Both links off one message ride on it, space-separated as Discord wrote them.
    expect(metaText(pipeline[0].item.metadata.Attachments).split(/\s+/).length).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('malformed / binary input does not throw', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-malformed-'));
    const chan = path.join(dir, 'messages', 'c999');
    fs.mkdirSync(chan, { recursive: true });
    fs.writeFileSync(
      path.join(chan, 'messages.csv'),
      Buffer.from([0x00, 0xff, 0xfe, 0x22, 0x2c, 0x0a, 0x99]),
    );
    fs.writeFileSync(path.join(chan, 'channel.json'), '{ not valid json ,,,');
    const fi = new DiscordFileImporter();
    const pipeline: EmittedGraph[] = [];
    await expect(
      fi.fileImport({}, { filename: 'x', fullPath: dir }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams),
    ).resolves.toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('same-timestamp messages stay distinct via stable ids (idempotent)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-dedup-'));
    const chan = path.join(dir, 'messages', 'c123456');
    fs.mkdirSync(chan, { recursive: true });
    fs.writeFileSync(
      path.join(chan, 'messages.csv'),
      'ID,Timestamp,Contents,Attachments\n' +
        '1001,2024-01-01T12:00:00.000+00:00,first,\n' +
        '1002,2024-01-01T12:00:00.000+00:00,second,\n' +
        '1003,2024-01-01T12:00:00.000+00:00,third,\n',
    );
    const fi = new DiscordFileImporter();
    const run = async () => {
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'x', fullPath: dir }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      return pipeline;
    };

    const pipeline = await run();
    expect(pipeline.length).toBe(3);
    const ids = pipeline.map((p) => p.item.id!);
    expect(ids.every((id) => !!id)).toBe(true);
    expect(new Set(ids).size).toBe(3);

    const idsAgain = (await run()).map((p) => p.item.id!);
    expect(idsAgain).toEqual(ids);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('empty input yields no items', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-empty-'));
    const chan = path.join(dir, 'messages', 'c000');
    fs.mkdirSync(chan, { recursive: true });
    fs.writeFileSync(path.join(chan, 'messages.csv'), '');
    const fi = new DiscordFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'x', fullPath: dir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline.length).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
