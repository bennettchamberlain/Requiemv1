/* Goodreads — library CSV export (goodreads_library_export.csv). */
import fs from 'node:fs';
import path from 'node:path';

import { parseCSV } from './csv';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

const GOODREADS_FILENAME = 'goodreads_library_export.csv';

function headerHasGoodreadsCols(text: string): boolean {
  const nl = text.indexOf('\n');
  const header = nl === -1 ? text : text.slice(0, nl);

  // Must have "Book Id" but must NOT be Letterboxd (which also has "Name" etc.)
  return header.includes('Book Id') && !header.includes('Letterboxd URI');
}

// Parse YYYY/MM/DD date string → Date (midnight UTC)
function parseGoodreadsDate(s: string): Date | undefined {
  if (!s) {
    return undefined;
  }

  // Format is YYYY/MM/DD
  const d = new Date(`${s.replace(/\//g, '-')}T00:00:00Z`);

  return isNaN(d.getTime()) ? undefined : d;
}

export class GoodreadsFileImporter implements FileImporter {
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
      if (base === GOODREADS_FILENAME) {
        return { confidence: 0.97 };
      }

      if (path.extname(base) === '.csv' && this.headerMatches(root)) {
        return { confidence: 0.7 };
      }

      return { confidence: 0 };
    }

    if (stat.isDirectory()) {
      try {
        const names = fs.readdirSync(root);
        if (names.some((n) => n.toLowerCase() === GOODREADS_FILENAME)) {
          return { confidence: 0.97 };
        }

        for (const name of names) {
          if (path.extname(name).toLowerCase() !== '.csv') {
            continue;
          }

          if (this.headerMatches(path.join(root, name))) {
            return { confidence: 0.7 };
          }
        }
      } catch {
        /* ignore */
      }

      return { confidence: 0, dir_threshold: 0.7 };
    }

    return { confidence: 0 };
  }

  // Read only the first ~4KB to inspect the CSV header row.
  private headerMatches(fpath: string): boolean {
    let fd: number | undefined;
    try {
      fd = fs.openSync(fpath, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);

      return headerHasGoodreadsCols(buf.toString('utf8', 0, n));
    } catch {
      return false;
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

    if (stat.isFile()) {
      await this.processFile(root, params);
    } else if (stat.isDirectory()) {
      let names: string[];
      try {
        names = fs.readdirSync(root);
      } catch {
        return;
      }

      const exact = names.find((n) => n.toLowerCase() === GOODREADS_FILENAME);
      if (exact) {
        await this.processFile(path.join(root, exact), params);
      } else {
        for (const name of names) {
          if (path.extname(name).toLowerCase() !== '.csv') {
            continue;
          }

          const fpath = path.join(root, name);
          if (this.headerMatches(fpath)) {
            await this.processFile(fpath, params);
          }
        }
      }
    }
  }

  private async processFile(fpath: string, params: ImportParams): Promise<void> {
    const base = path.basename(fpath);
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', `Failed to read ${base}`, { error: (e as Error).message });

      return;
    }

    let rows: Record<string, string>[];
    try {
      rows = parseCSV(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${base}`, { error: (e as Error).message });

      return;
    }

    for (const row of rows) {
      try {
        this.pushRow(row, params);
      } catch (e) {
        params.log?.('error', `Failed to import row in ${base}`, { error: (e as Error).message });
      }
    }
  }

  private pushRow(row: Record<string, string>, params: ImportParams): void {
    // Prefer Date Read; fall back to Date Added
    const ts = parseGoodreadsDate(row['Date Read'] || '') ?? parseGoodreadsDate(row['Date Added'] || '');
    if (!timeframeContains(params.timeframe, ts)) {
      return;
    }

    const title = row['Title'] || '';
    const review = row['My Review'] || '';
    // Use 'annotation' if the user left a review, otherwise 'interaction'
    // Both reviewed and shelved books are reading annotations → route to content
    // (reading.annotation). 'interaction' was unmapped and fell through to a
    // generic event; only the review.txt/book.txt filename now reflects the diff.
    const classification = 'annotation';

    params.pipeline.push({
      item: {
        id: `goodreads:${row['Book Id'] || row['ISBN13'] || row['ISBN'] || `${title}|${row['Author'] || ''}`}`,
        classification,
        timestamp: ts,
        content: {
          filename: review ? 'review.txt' : 'book.txt',
          mediaType: 'text/plain',
          data: async () => Buffer.from(review || title),
        },
        metadata: {
          Title: title || undefined,
          Author: row['Author'] || undefined,
          MyRating: row['My Rating'] || undefined,
          AverageRating: row['Average Rating'] || undefined,
          ExclusiveShelf: row['Exclusive Shelf'] || undefined,
          DateRead: row['Date Read'] || undefined,
          DateAdded: row['Date Added'] || undefined,
          ISBN: row['ISBN'] || undefined,
          ISBN13: row['ISBN13'] || undefined,
          Publisher: row['Publisher'] || undefined,
          Binding: row['Binding'] || undefined,
          NumberOfPages: row['Number of Pages'] || undefined,
          YearPublished: row['Year Published'] || undefined,
          Bookshelves: row['Bookshelves'] || undefined,
          Source: 'Goodreads',
        },
      },
    });
  }
}

registerDataSource({
  name: 'goodreads',
  title: 'Goodreads',
  icon: '',
  description: 'Book library and reading history from a Goodreads CSV export (goodreads_library_export.csv).',
  newFileImporter: () => new GoodreadsFileImporter(),
});
