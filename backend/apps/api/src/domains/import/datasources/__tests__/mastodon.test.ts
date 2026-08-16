import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import { MastodonFileImporter } from '../mastodon';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Mastodon datasource', () => {
  it('recognizes export directory by outbox.json (with actor.json corroboration)', async () => {
    const root = path.join(FIXTURES_DIR, 'mastodon-export');
    const fi = new MastodonFileImporter();
    const rec = await fi.recognize({}, { filename: 'mastodon-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes a single outbox.json file directly', async () => {
    const fpath = path.join(FIXTURES_DIR, 'mastodon-export', 'outbox.json');
    const fi = new MastodonFileImporter();
    const rec = await fi.recognize({}, { filename: 'outbox.json', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('does not match an unrelated directory', async () => {
    const root = path.join(FIXTURES_DIR, 'netflix-export');
    const fi = new MastodonFileImporter();
    const rec = await fi.recognize({}, { filename: 'netflix-export', fullPath: root });
    expect(rec.confidence).toBe(0);
  });

  it('imports Create/Note activities as post items and skips boosts', async () => {
    const root = path.join(FIXTURES_DIR, 'mastodon-export');
    const fi = new MastodonFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'mastodon-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    // Two Create/Note posts; the Announce (boost) is skipped.
    expect(pipeline.length).toBe(2);

    const first = pipeline[0].item;
    expect(first.classification).toBe('post');
    expect(first.metadata.Source).toBe('Mastodon');
    expect(first.metadata.URL).toBe('https://mastodon.social/@alice/110001');
    expect(first.timestamp).toBeInstanceOf(Date);
    expect(first.timestamp!.toISOString()).toBe('2023-01-15T10:30:00.000Z');
    // No content warning on the first post.
    expect(first.metadata['Content Warning']).toBeUndefined();

    // HTML stripped + entities decoded.
    const firstText = (await first.content!.data!()).toString();
    expect(firstText).toBe("Hello #fediverse! This is my first post & it's exciting.");
    // The body lands in a title-bearing metadata key so the post titles by its
    // text rather than the bare 'post.txt' filename.
    expect(first.metadata.Text).toBe("Hello #fediverse! This is my first post & it's exciting.");
    expect(first.metadata.Text).not.toBe('post.txt');

    const second = pipeline[1].item;
    expect(second.classification).toBe('post');
    expect(second.metadata['Content Warning']).toBe('spoilers for the finale');
    const secondText = (await second.content!.data!()).toString();
    expect(secondText).toBe('Wow, that ending was wild.\n\nDid not see it coming!');
  });

  it('respects the timeframe filter', async () => {
    const root = path.join(FIXTURES_DIR, 'mastodon-export');
    const fi = new MastodonFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'mastodon-export', fullPath: root }, {
      pipeline,
      timeframe: { since: new Date('2023-02-01T00:00:00Z') },
      log: () => {},
    } as unknown as ImportParams);

    // Only the Feb post survives the since-filter.
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.metadata.URL).toBe('https://mastodon.social/@alice/110002');
  });

  it('does not throw on malformed JSON and pushes nothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastodon-bad-'));
    const fpath = path.join(dir, 'outbox.json');
    fs.writeFileSync(fpath, '{ this is not valid json ');
    try {
      const fi = new MastodonFileImporter();
      const rec = await fi.recognize({}, { filename: 'outbox.json', fullPath: fpath });
      expect(rec.confidence).toBe(0);

      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'outbox.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);
      expect(pipeline.length).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not throw on an empty file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastodon-empty-'));
    const fpath = path.join(dir, 'outbox.json');
    fs.writeFileSync(fpath, '');
    try {
      const fi = new MastodonFileImporter();
      const rec = await fi.recognize({}, { filename: 'outbox.json', fullPath: fpath });
      expect(rec.confidence).toBe(0);

      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'outbox.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);
      expect(pipeline.length).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
