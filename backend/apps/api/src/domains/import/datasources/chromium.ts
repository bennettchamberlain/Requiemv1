/**
 * Chromium-family browsing history and bookmarks.
 *
 * Covers Chrome, Brave, Edge, Arc, Opera - anything that ships the standard
 * Chromium `History` SQLite database. We recognize by filename and confirm the
 * `urls`/`visits` tables exist, then project one Item per visit.
 *
 * Bookmarks live in a separate `Bookmarks` file (JSON, no extension) beside the
 * history database, so it recognizes as its own import root and is dispatched
 * independently - dropping a whole profile folder picks up both without
 * importing either twice.
 *
 * Mirrors the firefox.ts importer. The only Chromium-specific wrinkle is the
 * timestamp epoch: Chromium stores visit_time (and a bookmark's date_added) as
 * microseconds since 1601-01-01 UTC, so we offset by the 1601->1970 gap before
 * constructing a Date.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { asRecord } from './json';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, Graph } from './timeline';
import { timeframeContains } from './timeline';

// Milliseconds between 1601-01-01 (Chromium/Windows FILETIME epoch) and the
// Unix epoch (1970-01-01).
const CHROME_EPOCH_OFFSET_MS = 11644473600000;

// Filenames a Chromium-based browser uses for its history database.
const HISTORY_FILENAMES = new Set([
  'history',
  'history.sqlite',
  'history-chrome',
  'history-brave',
  'history-edge',
  'history-arc',
]);

// Filenames a Chromium-based browser uses for its bookmark file. It ships as
// `Bookmarks` with no extension; `Bookmarks.bak` is deliberately absent (it is
// the previous revision and would duplicate everything).
const BOOKMARK_FILENAMES = new Set([
  'bookmarks',
  'bookmarks.json',
  'bookmarks-chrome',
  'bookmarks-brave',
  'bookmarks-edge',
  'bookmarks-arc',
]);

// A bookmark's date_added arrives as a STRING of microseconds, so isFinite also
// rejects the unparseable rather than letting NaN through to an Invalid Date.
function chromeTimeToDate(micros: number): Date | undefined {
  if (typeof micros !== 'number' || !Number.isFinite(micros) || micros <= 0) {
    return undefined;
  }

  return new Date(Math.floor(micros / 1000) - CHROME_EPOCH_OFFSET_MS);
}

interface ChromiumBookmarkNode {
  type?: string;
  name?: string;
  url?: string;
  date_added?: string | number;
  children?: ChromiumBookmarkNode[];
}

interface FlatBookmark {
  url: string;
  title: string;
  dateAdded?: string | number;
  folder?: string;
}

/**
 * Walk the bookmark tree, carrying the enclosing folder's name down to its
 * children so each link records the folder it was saved in (the roots name
 * themselves "Bookmarks bar" / "Other bookmarks", which is what a user sees).
 */
function flattenBookmarks(
  node: ChromiumBookmarkNode | undefined,
  folder: string | undefined,
  out: FlatBookmark[],
  depth = 0,
): FlatBookmark[] {
  if (!node || typeof node !== 'object' || depth > 20) {
    return out;
  }

  if (node.type === 'url' && node.url) {
    out.push({ url: node.url, title: node.name || '', dateAdded: node.date_added, folder });

    return out;
  }

  if (Array.isArray(node.children)) {
    const childFolder = node.name || folder;
    for (const child of node.children) {
      flattenBookmarks(child, childFolder, out, depth + 1);
    }
  }

  return out;
}

/** Parse a Chromium `Bookmarks` file, or undefined when it is not one. */
function readBookmarksFile(fpath: string): FlatBookmark[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(fpath, 'utf8'));
  } catch {
    return undefined;
  }

  // The Takeout export is `Bookmarks.html` (Netscape format, handled by
  // google_chrome.ts); the live profile file is JSON keyed by `roots`.
  const doc = asRecord(parsed);
  const roots = asRecord(doc?.roots);
  if (!roots) {
    return undefined;
  }

  const out: FlatBookmark[] = [];
  for (const root of Object.values(roots)) {
    flattenBookmarks(root as ChromiumBookmarkNode, undefined, out);
  }

  return out;
}

class ChromiumFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const full = entry.fullPath || entry.fsRoot || entry.filename;
    if (!full) {
      return { confidence: 0 };
    }

    const base = path.basename(full).toLowerCase();

    if (BOOKMARK_FILENAMES.has(base)) {
      if (!fs.existsSync(full)) {
        return { confidence: 0 };
      }

      // Confirm it parses as a Chromium bookmark tree rather than some other
      // file named "Bookmarks" (notably the Takeout `Bookmarks.html`).
      return readBookmarksFile(full) ? { confidence: 0.95 } : { confidence: 0 };
    }

    if (!HISTORY_FILENAMES.has(base)) {
      return { confidence: 0 };
    }

    if (!fs.existsSync(full)) {
      return { confidence: 0 };
    }

    // Confirm this is actually a Chromium history DB rather than some other
    // file that happens to be named "History".
    let db: Database.Database | undefined;
    try {
      db = new Database(full, { readonly: true, fileMustExist: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('urls', 'visits')")
        .all() as Array<{ name: string }>;

      return tables.length === 2 ? { confidence: 0.95 } : { confidence: 0 };
    } catch {
      return { confidence: 0 };
    } finally {
      try {
        db?.close();
      } catch {
        /* already closed */
      }
    }
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const fpath = entry.fullPath || entry.fsRoot || entry.filename;
    if (!fpath || !fs.existsSync(fpath)) {
      return;
    }

    if (BOOKMARK_FILENAMES.has(path.basename(fpath).toLowerCase())) {
      this.importBookmarks(fpath, params);

      return;
    }

    this.importHistory(fpath, params);
  }

  /**
   * Saved bookmarks from the profile's `Bookmarks` JSON. Emits the same
   * `bookmark` item shape as firefox.ts and google_chrome.ts - Title / URL /
   * Folder / Added Date - so every browser lands on CI-Server's `web.bookmark`
   * the same way.
   */
  private importBookmarks(fpath: string, params: ImportParams): void {
    const bookmarks = readBookmarksFile(fpath);
    if (!bookmarks) {
      params.log?.('error', 'parse chromium Bookmarks failed', { path: fpath });

      return;
    }

    for (const b of bookmarks) {
      const ts = chromeTimeToDate(Number(b.dateAdded));
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      // Key on (url, date_added) so re-saving the same page stays distinct and a
      // re-import of the same file dedups via INSERT OR IGNORE.
      const id =
        'chromium:bookmark:' +
        crypto
          .createHash('sha1')
          .update(`${b.url} ${b.dateAdded ?? ''}`)
          .digest('hex');
      params.pipeline.push({
        item: {
          id,
          classification: 'bookmark',
          timestamp: ts,
          intermediateLocation: fpath,
          content: {
            filename: 'bookmark.txt',
            mediaType: 'text/plain',
            data: async () => Buffer.from(`${b.title}\n${b.url}`),
          },
          metadata: {
            // A title-less save (Chrome allows editing a bookmark's name down
            // to empty) left `Title` undefined, which push/canonical.ts's
            // titleFor() falls through all the way to the row's own filename
            // — this content's is the constant 'bookmark.txt', so every
            // untitled bookmark showed that instead of the page it saved. The
            // URL is always present for a real bookmark and is at least the
            // saved page, not a meaningless constant shared by every one of
            // them.
            Title: b.title || b.url || undefined,
            URL: b.url,
            Folder: b.folder || undefined,
            'Added Date': ts?.toISOString(),
            Source: 'Chromium',
          },
        },
      } as Graph);
    }
  }

  private importHistory(dbPath: string, params: ImportParams): void {
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (e) {
      params.log?.('error', 'open chromium History failed', { error: (e as Error).message });

      return;
    }

    try {
      // Chromium's visits.url column is a foreign key onto urls.id.
      const stmt = db.prepare(`SELECT u.url AS url, u.title AS title, v.visit_time AS visit_time
        FROM visits v
        INNER JOIN urls u ON u.id = v.url
        ORDER BY v.visit_time ASC`);

      for (const row of stmt.iterate() as Iterable<{
        url: string;
        title: string | null;
        visit_time: number;
      }>) {
        const ts = chromeTimeToDate(row.visit_time);
        if (!timeframeContains(params.timeframe, ts)) {
          continue;
        }

        const url = row.url || '';
        // Stable id per (url, visit_time): distinct visits stay distinct, and a
        // re-import of the same database dedups via INSERT OR IGNORE.
        const id = 'chromium:' + crypto.createHash('sha1').update(`${url} ${row.visit_time}`).digest('hex');

        const item = {
          id,
          classification: 'page_view',
          timestamp: ts,
          intermediateLocation: dbPath,
          content: { filename: 'url.txt', data: async () => Buffer.from(url) },
          metadata: {
            Source: 'Chromium',
            URL: url,
            Title: row.title || undefined,
            'Visit Date': ts?.toISOString(),
          },
        };
        params.pipeline.push({ item } as Graph);
      }
    } catch (e) {
      params.log?.('error', 'chromium query failed', { error: (e as Error).message });
    } finally {
      try {
        db?.close();
      } catch {
        /* already closed */
      }
    }
  }
}

registerDataSource({
  name: 'chromium',
  title: 'Chromium browsers (Chrome / Brave / Edge / Arc)',
  icon: '',
  description:
    'Browsing history (URLs + visit timestamps) and saved bookmarks from any Chromium-based browser.',
  newFileImporter: () => new ChromiumFileImporter(),
});
