import path from 'path';

import type { ImportParams } from '../timeline';
import { YouTubeFileImporter } from '../youtube';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('YouTube datasource', () => {
  it('recognizes directory containing watch-history.json', async () => {
    const root = path.join(FIXTURES_DIR, 'youtube-export');
    const fi = new YouTubeFileImporter();
    const rec = await fi.recognize({}, { filename: 'youtube-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes watch-history.json file directly', async () => {
    const fpath = path.join(FIXTURES_DIR, 'youtube-export', 'watch-history.json');
    const fi = new YouTubeFileImporter();
    const rec = await fi.recognize({}, { filename: 'watch-history.json', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('imports watch items (only YouTube/YouTube Music headers)', async () => {
    const root = path.join(FIXTURES_DIR, 'youtube-export');
    const fi = new YouTubeFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'youtube-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    // 2 YouTube + 1 YouTube Music = 3; Google Search excluded
    expect(pipeline.length).toBe(3);
    expect(pipeline.every((p) => p.item.classification === 'watch')).toBe(true);
  });

  it('strips "Watched " prefix from title', async () => {
    const root = path.join(FIXTURES_DIR, 'youtube-export');
    const fi = new YouTubeFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'youtube-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const item = pipeline[0].item;
    expect(item.metadata.Title).toBe('How to Code in Python - Full Course');
    expect(item.metadata.Channel).toBe('freeCodeCamp.org');
    expect(item.metadata.URL).toContain('youtube.com');
    expect(item.timestamp).toBeDefined();
  });

  it('sets a stable, distinct id on every JSON item', async () => {
    const root = path.join(FIXTURES_DIR, 'youtube-export');
    const fi = new YouTubeFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'youtube-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const ids = pipeline.map((p) => p.item.id!);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id: string) => id.startsWith('youtube:'))).toBe(true);
  });

  describe('HTML (modern Google MyActivity export)', () => {
    const HTML_ROOT = path.join(FIXTURES_DIR, 'youtube-html-export');

    it('recognizes a dir whose history/ subfolder holds watch-history.html', async () => {
      const fi = new YouTubeFileImporter();
      const rec = await fi.recognize({}, { filename: 'YouTube and YouTube Music', fullPath: HTML_ROOT });
      expect(rec.confidence).toBeGreaterThan(0.8);
    });

    it('recognizes watch-history.html directly', async () => {
      const fpath = path.join(HTML_ROOT, 'history', 'watch-history.html');
      const fi = new YouTubeFileImporter();
      const rec = await fi.recognize({}, { filename: 'watch-history.html', fullPath: fpath });
      expect(rec.confidence).toBeGreaterThan(0.8);
    });

    it('imports watch + search items with the right classifications', async () => {
      const fi = new YouTubeFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'YouTube and YouTube Music', fullPath: HTML_ROOT }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      const watches = pipeline.filter((p) => p.item.classification === 'watch');
      const searches = pipeline.filter((p) => p.item.classification === 'search');
      expect(watches.length).toBe(3);
      expect(searches.length).toBe(2);
      // every pushed item is watch or search
      expect(pipeline.length).toBe(5);
    });

    it('parses watch title/channel/url, decodes entities, and timestamps', async () => {
      const fpath = path.join(HTML_ROOT, 'history', 'watch-history.html');
      const fi = new YouTubeFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'watch-history.html', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      const first = pipeline[0].item;
      expect(first.classification).toBe('watch');
      expect(first.metadata.Title).toBe('UK & Election: Last Week Tonight'); // &amp; decoded
      expect(first.metadata.Channel).toBe('LastWeekTonight');
      expect(first.metadata.URL).toBe('https://www.youtube.com/watch?v=RZL_TctrNco');
      expect(first.timestamp).toBeInstanceOf(Date);
      expect(isNaN(first.timestamp!.getTime())).toBe(false);
      expect(first.timestamp!.getUTCFullYear()).toBe(2026);

      // Removed video: title equals the URL upstream and there's no channel anchor
      // either, so Title falls back to the URL rather than the uninformative
      // literal "watch.txt" content filename.
      const removed = pipeline[2].item;
      expect(removed.metadata.Title).toBe('https://www.youtube.com/watch?v=7dN39_6Ls6Q');
      expect(removed.metadata.URL).toBe('https://www.youtube.com/watch?v=7dN39_6Ls6Q');
    });

    it('parses search query into Title/Text and decodes entities', async () => {
      const fpath = path.join(HTML_ROOT, 'history', 'search-history.html');
      const fi = new YouTubeFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'search-history.html', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      expect(pipeline.length).toBe(2);
      const s0 = pipeline[0].item;
      expect(s0.classification).toBe('search');
      expect(s0.metadata.Title).toBe('companion intelligence');
      expect(s0.metadata.Text).toBe('companion intelligence');
      expect(s0.metadata.Query).toBe('companion intelligence');
      expect(s0.timestamp).toBeInstanceOf(Date);
      expect(pipeline[1].item.metadata.Text).toBe('rust & wasm'); // &amp; decoded
    });

    it('every HTML item has a truthy, distinct id and a non-filename Title/Text', async () => {
      const fi = new YouTubeFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'YouTube and YouTube Music', fullPath: HTML_ROOT }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      const ids = pipeline.map((p) => p.item.id!);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id: string) => id.startsWith('youtube:'))).toBe(true);
      // Title/Text is real content, never the bare filename.
      for (const p of pipeline) {
        const label = p.item.metadata.Title || p.item.metadata.Text || p.item.metadata.URL;
        expect(label).toBeTruthy();
        expect(label).not.toMatch(/\.html$/);
      }
    });
  });

  describe('subscriptions.csv', () => {
    const root = path.join(FIXTURES_DIR, 'youtube-subscriptions-export');

    it('recognizes a Takeout export containing only subscriptions.csv', async () => {
      const fi = new YouTubeFileImporter();
      const rec = await fi.recognize({}, { filename: 'youtube-subscriptions-export', fullPath: root });
      expect(rec.confidence).toBeGreaterThan(0.6);
    });

    it('recognizes subscriptions.csv directly by file', async () => {
      const fpath = path.join(root, 'YouTube and YouTube Music', 'subscriptions', 'subscriptions.csv');
      const fi = new YouTubeFileImporter();
      const rec = await fi.recognize({}, { filename: 'subscriptions.csv', fullPath: fpath });
      expect(rec.confidence).toBeGreaterThan(0.6);
    });

    it('does not recognize a same-named CSV with an unrelated header as subscriptions.csv', async () => {
      // Named subscriptions.csv but with a completely different (e.g. a
      // streaming-service billing export) header shape — confirms the
      // recognizer checks column headers, not just the filename.
      const fi = new YouTubeFileImporter();
      const rec = await fi.recognize(
        {},
        {
          filename: 'subscriptions.csv',
          fullPath: path.join(FIXTURES_DIR, 'unrelated-subscriptions-csv', 'subscriptions.csv'),
        },
      );
      expect(rec.confidence).toBe(0);
    });

    it('imports one item per subscribed channel', async () => {
      const fi = new YouTubeFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'youtube-subscriptions-export', fullPath: root }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      expect(pipeline.length).toBe(2);
      expect(pipeline.every((p) => p.item.classification === 'subscription')).toBe(true);
      expect(pipeline[0].item.metadata.Channel).toBe('freeCodeCamp.org');
      expect(pipeline[0].item.metadata.URL).toContain('youtube.com');
      expect(pipeline[0].item.metadata.ChannelId).toBe('UC7Q-BJs-7izPsRN907IOuBw');
      // Takeout's subscriptions export carries no per-row timestamp.
      expect(pipeline[0].item.timestamp).toBeUndefined();
    });

    it('gives each channel a stable, distinct id derived from the channel id', async () => {
      const fi = new YouTubeFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'youtube-subscriptions-export', fullPath: root }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      const ids = pipeline.map((p) => p.item.id!);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id: string) => id.startsWith('youtube:sub:'))).toBe(true);
    });
  });
});
