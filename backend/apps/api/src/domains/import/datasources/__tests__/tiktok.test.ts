import fs from 'fs';
import os from 'os';
import path from 'path';

import { TikTokFileImporter } from '../tiktok';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function importAll(): Promise<EmittedGraph[]> {
  const fpath = path.join(FIXTURES_DIR, 'tiktok-export', 'user_data_tiktok.json');
  const fi = new TikTokFileImporter();
  const pipeline: EmittedGraph[] = [];

  return fi
    .fileImport({}, { filename: 'user_data_tiktok.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams)
    .then(() => pipeline);
}

describe('TikTok datasource', () => {
  it('recognizes a TikTok data file', async () => {
    const fpath = path.join(FIXTURES_DIR, 'tiktok-export', 'user_data_tiktok.json');
    const fi = new TikTokFileImporter();
    const rec = await fi.recognize({}, { filename: 'user_data_tiktok.json', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('recognizes a directory containing a TikTok data file', async () => {
    const root = path.join(FIXTURES_DIR, 'tiktok-export');
    const fi = new TikTokFileImporter();
    const rec = await fi.recognize({}, { filename: 'tiktok-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('imports the expected counts and classifications', async () => {
    const pipeline = await importAll();
    // 2 watch + 1 like + 1 search + 1 comment + 2 DM = 7
    expect(pipeline.length).toBe(7);
    const byKind = (k: string) => pipeline.filter((p) => p.item.metadata.Kind === k);
    expect(byKind('browse').length).toBe(2);
    expect(byKind('like').length).toBe(1);
    expect(byKind('search').length).toBe(1);
    expect(byKind('comment').length).toBe(1);
    expect(byKind('dm').length).toBe(2);
    expect(byKind('browse').every((p) => p.item.classification === 'watch')).toBe(true);
    expect(byKind('dm').every((p) => p.item.classification === 'message')).toBe(true);
    expect(pipeline.every((p) => p.item.metadata.Source === 'TikTok')).toBe(true);
  });

  it('parses watch URLs (Link and VideoLink fallback)', async () => {
    const pipeline = await importAll();
    const watches = pipeline.filter((p) => p.item.metadata.Kind === 'browse');
    expect(watches[0].item.metadata.URL).toBe('https://www.tiktokv.com/share/video/1111/');
    // second watch uses VideoLink fallback and trailing " UTC" date
    expect(watches[1].item.metadata.URL).toBe('https://www.tiktokv.com/share/video/2222/');
    expect(watches[1].item.timestamp).toBeDefined();
  });

  it('parses DM Sender and Conversation correctly', async () => {
    const pipeline = await importAll();
    const dms = pipeline.filter((p) => p.item.metadata.Kind === 'dm');
    expect(dms[0].item.metadata.Sender).toBe('alice');
    expect(dms[0].item.metadata.Conversation).toBe('alice');
    expect(dms[1].item.metadata.Sender).toBe('bob');
    expect(dms[1].item.metadata.Conversation).toBe('alice');
  });

  it('derives DM recipient and direction for people-linking', async () => {
    const pipeline = await importAll();
    const dms = pipeline.filter((p) => p.item.metadata.Kind === 'dm');
    // inbound: sender (alice) == conversation -> received, no recipient
    expect(dms[0].item.metadata.Direction).toBe('received');
    expect(dms[0].item.metadata.To).toBeUndefined();
    expect(dms[0].item.metadata.ThreadId).toBe('alice');
    // outbound: sender (bob, the owner) != conversation -> sent to partner alice
    expect(dms[1].item.metadata.Direction).toBe('sent');
    expect(dms[1].item.metadata.To).toBe('alice');
    expect(dms[1].item.metadata.ThreadId).toBe('alice');
  });

  it('parses comment content', async () => {
    const pipeline = await importAll();
    const comment = pipeline.find((p) => p.item.metadata.Kind === 'comment');
    expect(comment!.item.metadata.Comment).toBe('This is hilarious!');
    expect(comment!.item.timestamp).toBeDefined();
  });

  it('surfaces a title-bearing metadata key (not the bare filename)', async () => {
    const pipeline = await importAll();
    const search = pipeline.find((p) => p.item.metadata.Kind === 'search');
    // Text drives titleFor's text branch, so the title is the query, not 'search.txt'
    expect(search!.item.metadata.Text).toBe('cat compilations');
    const comment = pipeline.find((p) => p.item.metadata.Kind === 'comment');
    expect(comment!.item.metadata.Text).toBe('This is hilarious!');
    const watch = pipeline.find((p) => p.item.metadata.Kind === 'browse');
    // URL-only rows get a readable Title (parsed video id), not 'watch.txt'
    expect(watch!.item.metadata.Title).toBe('TikTok video 1111');
    const like = pipeline.find((p) => p.item.metadata.Kind === 'like');
    expect(like!.item.metadata.Title).toBeDefined();
    expect(like!.item.metadata.Title).not.toBe('like.txt');
  });

  it('malformed input does not throw', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-bad-'));
    const fpath = path.join(dir, 'user_data_tiktok.json');
    fs.writeFileSync(fpath, '\x00\x01garbage}{][not json');
    const fi = new TikTokFileImporter();
    const pipeline: EmittedGraph[] = [];
    await expect(
      fi.recognize({}, { filename: 'user_data_tiktok.json', fullPath: fpath }),
    ).resolves.toBeDefined();
    await expect(
      fi.fileImport({}, { filename: 'user_data_tiktok.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams),
    ).resolves.toBeUndefined();
    expect(pipeline.length).toBe(0);
  });

  it('empty / sectionless input yields no items', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-empty-'));
    const fpath = path.join(dir, 'user_data_tiktok.json');
    fs.writeFileSync(fpath, '{}');
    const fi = new TikTokFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'user_data_tiktok.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline.length).toBe(0);
  });

  // Regression: every push site (watch/like/favorite/search/comment/dm) uses a
  // constant content.filename ('watch.txt', 'like.txt', …), and TikTok's own
  // Date is second-precision. Without an explicit item.id, hashItem's fallback
  // hashes only (data_source, classification, filename, timestamp) — so two
  // videos watched or liked in the same rapid-fire second silently collapse
  // into one row on INSERT OR IGNORE, with no test failure to reveal it.
  it('assigns unique, stable ids to rows that would otherwise dedup-collapse on a shared timestamp', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-collapse-'));
    const fpath = path.join(dir, 'user_data_tiktok.json');
    const sameInstant = '2024-06-01 12:00:00';
    const exportJson = {
      Activity: {
        'Video Browsing History': {
          VideoList: [
            { Date: sameInstant, Link: 'https://www.tiktokv.com/share/video/1111/' },
            { Date: sameInstant, Link: 'https://www.tiktokv.com/share/video/2222/' },
          ],
        },
        'Like List': {
          ItemFavoriteList: [
            { Date: sameInstant, Link: 'https://www.tiktokv.com/share/video/3333/' },
            { Date: sameInstant, Link: 'https://www.tiktokv.com/share/video/4444/' },
          ],
        },
        'Favorite Videos': {
          FavoriteVideoList: [
            { Date: sameInstant, Link: 'https://www.tiktokv.com/share/video/5555/' },
            { Date: sameInstant, Link: 'https://www.tiktokv.com/share/video/6666/' },
          ],
        },
        'Search History': {
          SearchList: [
            { Date: sameInstant, SearchTerm: 'cats' },
            { Date: sameInstant, SearchTerm: 'dogs' },
          ],
        },
      },
      Comment: {
        Comments: {
          CommentsList: [
            { Date: sameInstant, Comment: 'first!' },
            { Date: sameInstant, Comment: 'second!' },
          ],
        },
      },
      'Direct Messages': {
        'Chat History': {
          ChatHistory: {
            'Chat History with alice:': [
              { Date: sameInstant, From: 'alice', Content: 'hi' },
              { Date: sameInstant, From: 'bob', Content: 'hey' },
            ],
          },
        },
      },
    };
    fs.writeFileSync(fpath, JSON.stringify(exportJson));

    const run = async () => {
      const fi = new TikTokFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'user_data_tiktok.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      return pipeline;
    };

    const items = await run();
    // 2 watch + 2 like + 2 favorite + 2 search + 2 comment + 2 dm = 12
    expect(items.length).toBe(12);
    const ids = items.map((p) => p.item.id);
    // (a) every push site sets an id
    expect(ids.every(Boolean)).toBe(true);
    // (b) all ids are unique despite every row in a given kind sharing the
    // same classification, constant filename, and identical timestamp.
    expect(new Set(ids).size).toBe(items.length);

    // (c) re-importing the same export yields identical ids (idempotent).
    const again = await run();
    expect(again.map((p) => p.item.id)).toEqual(ids);
  });
});
