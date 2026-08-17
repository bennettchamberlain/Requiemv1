/* YouTube — watch + search history from Google Takeout.
 * Supports both the legacy JSON export (watch-history.json) and the modern
 * Google MyActivity HTML export (watch-history.html / search-history.html). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parseCSV } from './csv';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, Graph } from './timeline';
import { timeframeContains } from './timeline';

interface WatchEntry {
  header?: string;
  title?: string;
  titleUrl?: string;
  subtitles?: Array<{ name?: string; url?: string }>;
  time?: string;
}

const HISTORY_FILES = new Set([
  'watch-history.json',
  'search-history.json',
  'watch-history.html',
  'search-history.html',
]);

const SUBSCRIPTIONS_FILENAME = 'subscriptions.csv';

// Takeout's subscriptions.csv is a generic filename other exports could reuse
// (e.g. a streaming-service billing export), so confirm the header shape too.
function subscriptionsHeaderMatches(text: string): boolean {
  const nl = text.indexOf('\n');
  const header = nl === -1 ? text : text.slice(0, nl);

  return header.includes('Channel Id') && header.includes('Channel Url') && header.includes('Channel Title');
}

// Google MyActivity exports separate each entry with this cell container.
const ENTRY_RE =
  /<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">([\s\S]*?)<\/div>/g;
const ANCHOR_RE = /<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

// Removed/private videos carry no title (video.text === video.url in the HTML
// path, or a blank e.title in the JSON path). Leaving metadata.Title undefined
// there made the title-derivation fall back to content.filename — the literal,
// uninformative "watch.txt" for every such row. Fall back to something that
// actually identifies the video instead.
function watchTitle(title: string, channel: string, url: string): string | undefined {
  return title || channel || url || undefined;
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

// Minimal HTML-entity decode for the few entities MyActivity emits.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&emsp;/g, ' ');
}

// Google writes the timestamp with a narrow no-break space (U+202F) and a
// trailing TZ abbreviation (e.g. "Jun 18, 2026, 7:30:56 PM PDT"). Normalise the
// exotic spaces; V8's Date parser understands the rest including the TZ.
function parseActivityDate(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const norm = raw.replace(/[\u202F\u00A0]/g, ' ').trim();
  if (!norm) {
    return undefined;
  }

  const d = new Date(norm);

  return isNaN(d.getTime()) ? undefined : d;
}

export class YouTubeFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const root = entry.fullPath || entry.fsRoot || entry.filename;
    if (!root) {
      return { confidence: 0 };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(root);
    } catch {
      return { confidence: 0 };
    }

    if (stat.isFile()) {
      const base = path.basename(root).toLowerCase();
      if (HISTORY_FILES.has(base)) {
        return { confidence: 0.9 };
      }

      if (base === SUBSCRIPTIONS_FILENAME) {
        try {
          if (subscriptionsHeaderMatches(fs.readFileSync(root, 'utf8'))) {
            return { confidence: 0.85 };
          }
        } catch {
          /* ignore */
        }
      }

      return { confidence: 0 };
    }

    if (stat.isDirectory()) {
      try {
        const names = fs.readdirSync(root).map((n) => n.toLowerCase());
        if (names.includes('watch-history.json') || names.includes('watch-history.html')) {
          return { confidence: 0.9 };
        }

        // "YouTube and YouTube Music" Takeout folder
        const dirName = path.basename(root).toLowerCase();
        if (dirName.includes('youtube') && names.some((n) => n === 'history')) {
          return { confidence: 0.85 };
        }

        if (names.some((n) => n === 'history')) {
          const histPath = path.join(root, names.find((n) => n === 'history')!);
          const histNames = fs.readdirSync(histPath).map((f) => f.toLowerCase());
          if (histNames.includes('watch-history.json') || histNames.includes('watch-history.html')) {
            return { confidence: 0.9 };
          }
        }

        if (this.findSubscriptionsCsv(root)) {
          return { confidence: 0.85 };
        }
      } catch {
        /* ignore */
      }

      return { confidence: 0, dir_threshold: 0.6 };
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const root = entry.fullPath || entry.fsRoot || entry.filename;
    if (!root) {
      return;
    }

    let files: string[] = [];
    let subsFile: string | undefined;
    try {
      const stat = fs.statSync(root);
      if (stat.isFile()) {
        if (path.basename(root).toLowerCase() === SUBSCRIPTIONS_FILENAME) {
          subsFile = root;
        } else {
          files = [root];
        }
      } else if (stat.isDirectory()) {
        files = this.findHistoryFiles(root);
        subsFile = this.findSubscriptionsCsv(root);
      }
    } catch {
      return;
    }

    if (!files.length && !subsFile) {
      params.log?.('warn', 'YouTube: no watch/search history or subscriptions.csv found');

      return;
    }

    for (const f of files) {
      const base = path.basename(f).toLowerCase();
      let raw: string;
      try {
        raw = await fs.promises.readFile(f, 'utf8');
      } catch (e) {
        params.log?.('error', 'Failed to read YouTube history', { file: f, error: (e as Error).message });
        continue;
      }

      if (base.endsWith('.html')) {
        this.importHtml(raw, base, params);
      } else {
        this.importJson(raw, params);
      }
    }

    if (subsFile) {
      await this.importSubscriptions(subsFile, params);
    }
  }

  private importJson(raw: string, params: ImportParams): void {
    let arr: WatchEntry[];
    try {
      arr = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(arr)) {
      return;
    }

    let index = 0;
    for (const e of arr) {
      if (e.header !== 'YouTube' && e.header !== 'YouTube Music') {
        continue;
      }

      const i = index++;
      const ts = e.time ? new Date(e.time) : undefined;
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const title = (e.title ?? '').replace(/^Watched /, '');
      const url = e.titleUrl ?? '';
      const channel = e.subtitles?.[0]?.name ?? '';
      const id = 'youtube:' + (url || ts ? sha1(`${url} ${ts?.toISOString() ?? ''}`) : String(i));
      params.pipeline.push({
        item: {
          id,
          classification: 'watch',
          timestamp: ts,
          content: {
            filename: 'watch.txt',
            mediaType: 'text/plain',
            data: async () => Buffer.from(url || title),
          },
          metadata: {
            Title: watchTitle(title, channel, url),
            URL: url || undefined,
            Channel: channel || undefined,
            Source: 'YouTube',
          },
        },
      } as Graph);
    }
  }

  private importHtml(raw: string, base: string, params: ImportParams): void {
    const isSearch = base.startsWith('search');
    let index = 0;
    let m: RegExpExecArray | null;
    ENTRY_RE.lastIndex = 0;
    while ((m = ENTRY_RE.exec(raw)) !== null) {
      const cell = m[1];
      // The action verb ("Watched", "Searched for") precedes the first anchor.
      const verbMatch = /^([\s\S]*?)<a /.exec(cell);
      const verb = verbMatch
        ? decodeEntities(verbMatch[1].replace(/<[^>]*>/g, ''))
            .replace(/[\u202F\u00A0]/g, ' ')
            .trim()
        : '';

      const anchors: Array<{ url: string; text: string }> = [];
      ANCHOR_RE.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ANCHOR_RE.exec(cell)) !== null) {
        anchors.push({
          url: decodeEntities(a[1]),
          text: decodeEntities(a[2].replace(/<[^>]*>/g, '')).trim(),
        });
      }

      if (!anchors.length) {
        continue;
      }

      // The timestamp is the trailing text node after the last <br>.
      const tail = cell.replace(/<[^>]*>/g, '\n');
      const lines = tail
        .split('\n')
        .map((l) =>
          decodeEntities(l)
            .replace(/[\u202F\u00A0]/g, ' ')
            .trim(),
        )
        .filter(Boolean);
      const ts = parseActivityDate(lines[lines.length - 1]);
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const i = index++;

      if (isSearch || /^Searched/i.test(verb)) {
        const query = anchors[0].text;
        const url = anchors[0].url;
        const id = 'youtube:' + (url || ts ? sha1(`${url} ${ts?.toISOString() ?? ''}`) : String(i));
        params.pipeline.push({
          item: {
            id,
            classification: 'search',
            timestamp: ts,
            content: {
              filename: 'search.txt',
              mediaType: 'text/plain',
              data: async () => Buffer.from(query),
            },
            metadata: {
              Title: query || undefined,
              Text: query || undefined,
              Query: query || undefined,
              URL: url || undefined,
              Kind: 'search',
              Source: 'YouTube',
            },
          },
        } as Graph);
        continue;
      }

      // Watch entry: first anchor is the video (title may equal the URL for
      // removed/private videos); a second anchor, when present, is the channel.
      const video = anchors[0];
      const channel = anchors[1];
      const title = video.text && video.text !== video.url ? video.text : '';
      const url = video.url;
      const id = 'youtube:' + (url || ts ? sha1(`${url} ${ts?.toISOString() ?? ''}`) : String(i));
      params.pipeline.push({
        item: {
          id,
          classification: 'watch',
          timestamp: ts,
          content: {
            filename: 'watch.txt',
            mediaType: 'text/plain',
            data: async () => Buffer.from(url || title),
          },
          metadata: {
            Title: watchTitle(title, channel?.text ?? '', url),
            URL: url || undefined,
            Channel: channel?.text || undefined,
            Source: 'YouTube',
          },
        },
      } as Graph);
    }
  }

  private async importSubscriptions(subsPath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(subsPath, 'utf8');
    } catch (e) {
      params.log?.('error', 'Failed to read YouTube subscriptions', { error: (e as Error).message });

      return;
    }

    let rows: Record<string, string>[];
    try {
      rows = parseCSV(raw);
    } catch (e) {
      params.log?.('error', 'Failed to parse YouTube subscriptions', { error: (e as Error).message });

      return;
    }

    // Subscriptions have no per-row timestamp in the Takeout export, so
    // `timeframeContains` always accepts them (undefined ts short-circuits).
    for (const row of rows) {
      const channelTitle = row['Channel Title'] || '';
      const channelUrl = row['Channel Url'] || '';
      const channelId = row['Channel Id'] || '';
      if (!channelTitle && !channelUrl && !channelId) {
        continue;
      }

      const id = 'youtube:sub:' + (channelId || sha1(channelUrl || channelTitle));
      params.pipeline.push({
        item: {
          id,
          classification: 'subscription',
          timestamp: undefined,
          content: {
            filename: 'subscription.txt',
            mediaType: 'text/plain',
            data: async () => Buffer.from(channelUrl || channelTitle),
          },
          metadata: {
            Channel: channelTitle || undefined,
            ChannelId: channelId || undefined,
            URL: channelUrl || undefined,
            Source: 'YouTube',
          },
        },
      } as Graph);
    }
  }

  private findSubscriptionsCsv(dir: string): string | undefined {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return undefined;
    }

    for (const name of entries) {
      const full = path.join(dir, name);
      if (name.toLowerCase() === SUBSCRIPTIONS_FILENAME) {
        try {
          if (subscriptionsHeaderMatches(fs.readFileSync(full, 'utf8'))) {
            return full;
          }
        } catch {
          /* ignore */
        }

        continue;
      }

      try {
        if (fs.statSync(full).isDirectory()) {
          const sub = this.findSubscriptionsCsv(full);
          if (sub) {
            return sub;
          }
        }
      } catch {
        /* ignore */
      }
    }

    return undefined;
  }

  private findHistoryFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      let entries: string[];
      try {
        entries = fs.readdirSync(d);
      } catch {
        return;
      }

      for (const name of entries) {
        const full = path.join(d, name);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }

        if (st.isDirectory()) {
          walk(full);
          continue;
        }

        if (HISTORY_FILES.has(name.toLowerCase())) {
          out.push(full);
        }
      }
    };

    walk(dir);
    // Prefer JSON watch-history when both JSON and HTML exist for the same data,
    // so a hybrid export isn't double-counted; otherwise import everything found.
    const hasWatchJson = out.some((f) => path.basename(f).toLowerCase() === 'watch-history.json');
    const hasWatchHtml = out.some((f) => path.basename(f).toLowerCase() === 'watch-history.html');
    if (hasWatchJson && hasWatchHtml) {
      return out.filter((f) => path.basename(f).toLowerCase() !== 'watch-history.html');
    }

    return out;
  }
}

registerDataSource({
  name: 'youtube',
  title: 'YouTube (Google Takeout)',
  icon: '',
  description: 'Watch history, search history, likes, subscriptions, playlists from a YouTube Takeout.',
  newFileImporter: () => new YouTubeFileImporter(),
});
