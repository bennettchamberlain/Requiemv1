/* Google Chrome — Takeout "Chrome/" export.

   Distinct from chromium.ts, which reads a live Chromium `History` SQLite
   database. Google Takeout ships the same data as JSON/HTML instead:
     - History.json:   { "Browser History": [ { url, title, time_usec,
                         page_transition_qualifier, ... } ] }
                       time_usec is MICROSECONDS since the Unix epoch.
     - Bookmarks.html: a Netscape-bookmark document, folder-organized with
                       <H3>Folder</H3> headings and <A HREF ADD_DATE=…>Title</A>
                       anchors. ADD_DATE is SECONDS since the Unix epoch.
   We emit one 'page_view' per visit and one 'bookmark' per saved link.
*/
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

const HISTORY_FILE = 'history.json';
const BOOKMARKS_FILE = 'bookmarks.html';

// Takeout stamps visits in microseconds since the Unix epoch.
function usecToDate(usec: unknown): Date | undefined {
  if (typeof usec !== 'number' || usec <= 0) {
    return undefined;
  }

  const d = new Date(Math.floor(usec / 1000));

  return isNaN(d.getTime()) ? undefined : d;
}

// Bookmark ADD_DATE is whole seconds since the Unix epoch.
function secToDate(sec: number | undefined): Date | undefined {
  if (typeof sec !== 'number' || sec <= 0) {
    return undefined;
  }

  const d = new Date(sec * 1000);

  return isNaN(d.getTime()) ? undefined : d;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// Read up to ~64KB of a file to sniff for a signature without slurping a
// potentially huge export (History.json runs to hundreds of thousands of rows)
// into memory just to recognize it.
function sniff(fpath: string): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(fpath, 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);

    return stripBom(buf.toString('utf8', 0, n));
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function looksLikeChromeHistory(fpath: string): boolean {
  return /"Browser History"\s*:/.test(sniff(fpath));
}

// A Chrome Takeout Bookmarks.html is the Netscape bookmark format. We require
// the NETSCAPE-Bookmark doctype and ADD_DATE attributes, and the ABSENCE of a
// `time_added` attribute: read-later services export the same container with
// that field instead, and such a file is not a Chrome bookmarks export.
function looksLikeChromeBookmarks(fpath: string): boolean {
  const head = sniff(fpath);

  return /NETSCAPE-Bookmark-file-1/i.test(head) && /ADD_DATE=/i.test(head) && !/time_added=/i.test(head);
}

// Recursively collect Chrome history/bookmark files beneath a directory. The job
// runner hands an importer the path it was enqueued against verbatim — which, for
// a dropped Google Takeout, is the archive ROOT, where Chrome/ is one of dozens
// of subfolders. So we walk (bounded depth) and match Takeout's fixed filenames,
// content-sniffing only those two names rather than every JSON/HTML in the tree.
function findChromeFiles(root: string, depth = 0): { history: string[]; bookmarks: string[] } {
  const out = { history: [] as string[], bookmarks: [] as string[] };
  if (depth > 6) {
    return out;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      const sub = findChromeFiles(p, depth + 1);
      out.history.push(...sub.history);
      out.bookmarks.push(...sub.bookmarks);
    } else if (e.isFile()) {
      const base = e.name.toLowerCase();
      if (base === HISTORY_FILE && looksLikeChromeHistory(p)) {
        out.history.push(p);
      } else if (base === BOOKMARKS_FILE && looksLikeChromeBookmarks(p)) {
        out.bookmarks.push(p);
      }
    }
  }

  return out;
}

// --- Bookmark parsing -------------------------------------------------------

interface ChromeBookmark {
  url: string;
  title: string;
  addDate?: number;
  folder?: string;
}

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const H3_RE = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;

function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(attrs);
  if (!m) {
    return undefined;
  }

  return m[2] !== undefined ? m[2] : m[3];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

// Locate each <H3> folder heading by byte offset so an anchor can be attributed
// to the most recent heading that precedes it (the folder it lives in).
function folderHeadings(html: string): Array<{ at: number; name: string }> {
  const out: Array<{ at: number; name: string }> = [];
  H3_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = H3_RE.exec(html)) !== null) {
    out.push({ at: m.index, name: decodeEntities(m[1].replace(/<[^>]*>/g, '').trim()) });
  }

  return out;
}

function folderFor(headings: Array<{ at: number; name: string }>, at: number): string | undefined {
  let folder: string | undefined;
  for (const h of headings) {
    if (h.at < at) {
      folder = h.name;
    } else {
      break;
    }
  }

  return folder || undefined;
}

function parseBookmarks(html: string): ChromeBookmark[] {
  const headings = folderHeadings(html);
  const out: ChromeBookmark[] = [];
  ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    const attrs = m[1] || '';
    const rawHref = attr(attrs, 'href');
    if (!rawHref) {
      continue;
    }

    // HREF attributes are HTML-escaped in the export (&amp; → &); decode so the
    // stored URL is the real one.
    const href = decodeEntities(rawHref);
    const title = decodeEntities(m[2].replace(/<[^>]*>/g, '').trim()) || href;
    const addRaw = attr(attrs, 'add_date');
    const addDate = addRaw && Number.isFinite(parseInt(addRaw, 10)) ? parseInt(addRaw, 10) : undefined;
    out.push({ url: href, title, addDate, folder: folderFor(headings, m.index) });
  }

  return out;
}

// --- History parsing --------------------------------------------------------

interface ChromeVisit {
  url?: string;
  title?: string;
  time_usec?: number;
  page_transition_qualifier?: string;
}

export class GoogleChromeFileImporter implements FileImporter {
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
      if (base.endsWith('.json') && looksLikeChromeHistory(root)) {
        return { confidence: base === HISTORY_FILE ? 0.95 : 0.85 };
      }

      if (base.endsWith('.html') && looksLikeChromeBookmarks(root)) {
        return { confidence: base === BOOKMARKS_FILE ? 0.9 : 0.8 };
      }

      return { confidence: 0 };
    }

    if (stat.isDirectory()) {
      const inChromeDir = path.basename(root).toLowerCase() === 'chrome';
      const found = findChromeFiles(root);
      if (found.history.length || found.bookmarks.length) {
        return { confidence: inChromeDir ? 0.95 : 0.85 };
      }

      return { confidence: 0, dir_threshold: 0.7 };
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const root = entry.fullPath || entry.fsRoot || entry.filename;
    if (!root) {
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(root);
    } catch {
      return;
    }

    const historyFiles: string[] = [];
    const bookmarkFiles: string[] = [];

    if (stat.isFile()) {
      const base = path.basename(root).toLowerCase();
      if (base.endsWith('.json') && looksLikeChromeHistory(root)) {
        historyFiles.push(root);
      } else if (base.endsWith('.html') && looksLikeChromeBookmarks(root)) {
        bookmarkFiles.push(root);
      }
    } else if (stat.isDirectory()) {
      const found = findChromeFiles(root);
      historyFiles.push(...found.history);
      bookmarkFiles.push(...found.bookmarks);
    }

    for (const f of historyFiles) {
      await this.importHistory(f, params);
    }

    for (const f of bookmarkFiles) {
      await this.importBookmarks(f, params);
    }
  }

  private async importHistory(fpath: string, params: ImportParams): Promise<void> {
    const base = path.basename(fpath);
    let raw: string;
    // History.json can be hundreds of MB. No streaming JSON parser is available
    // in this repo, so we read-and-parse the whole file; Node handles this size.
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', `Failed to read ${base}`, { error: (e as Error).message });

      return;
    }

    raw = stripBom(raw);
    if (!raw.trim()) {
      return;
    }

    let doc: { 'Browser History'?: ChromeVisit[] };
    try {
      doc = JSON.parse(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${base}`, { error: (e as Error).message });

      return;
    }

    const visits = Array.isArray(doc?.['Browser History']) ? doc['Browser History'] : [];
    for (const v of visits) {
      const url = typeof v?.url === 'string' ? v.url : '';
      if (!url) {
        params.pipeline.drop?.('empty_after_parse', 'history entry without url');
        continue;
      }

      const ts = usecToDate(v.time_usec);
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      // Stable id per (url, time_usec): distinct visits stay distinct and a
      // re-import dedups on the same key.
      const id =
        'google_chrome:' +
        crypto
          .createHash('sha1')
          .update(`${url} ${v.time_usec ?? ''}`)
          .digest('hex');
      params.pipeline.push({
        item: {
          id,
          classification: 'page_view',
          timestamp: ts,
          content: { filename: 'url.txt', mediaType: 'text/plain', data: async () => Buffer.from(url) },
          metadata: {
            Title: typeof v.title === 'string' && v.title ? v.title : undefined,
            URL: url,
            'Visit Date': ts?.toISOString(),
            Transition:
              typeof v.page_transition_qualifier === 'string' ? v.page_transition_qualifier : undefined,
            Source: 'Google Chrome',
          },
        },
      });
    }
  }

  private async importBookmarks(fpath: string, params: ImportParams): Promise<void> {
    const base = path.basename(fpath);
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', `Failed to read ${base}`, { error: (e as Error).message });

      return;
    }

    raw = stripBom(raw);
    let bookmarks: ChromeBookmark[];
    try {
      bookmarks = parseBookmarks(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${base}`, { error: (e as Error).message });

      return;
    }

    for (const b of bookmarks) {
      const ts = secToDate(b.addDate);
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      // ADD_DATE can be 0 ("Other Bookmarks" roots) or repeat across links, so
      // key on (url, addDate) to keep distinct saves distinct.
      const id =
        'google_chrome:bookmark:' +
        crypto
          .createHash('sha1')
          .update(`${b.url} ${b.addDate ?? ''}`)
          .digest('hex');
      params.pipeline.push({
        item: {
          id,
          classification: 'bookmark',
          timestamp: ts,
          content: {
            filename: 'bookmark.txt',
            mediaType: 'text/plain',
            data: async () => Buffer.from(`${b.title}\n${b.url}`),
          },
          metadata: {
            Title: b.title || undefined,
            URL: b.url,
            Folder: b.folder,
            'Added Date': ts?.toISOString(),
            Source: 'Google Chrome',
          },
        },
      });
    }
  }
}

registerDataSource({
  name: 'google_chrome',
  title: 'Google Chrome (Takeout)',
  icon: '',
  description:
    'Browsing history and bookmarks from a Google Takeout Chrome export (History.json, Bookmarks.html).',
  newFileImporter: () => new GoogleChromeFileImporter(),
});
