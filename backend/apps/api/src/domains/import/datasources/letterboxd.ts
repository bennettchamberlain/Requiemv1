/* Letterboxd — diary/ratings CSV export (diary.csv, ratings.csv). */
import fs from 'node:fs';
import path from 'node:path';

import { parseCSV } from './csv';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

const LETTERBOXD_FILES = ['diary.csv', 'ratings.csv'];

function headerHasLetterboxdCols(text: string): boolean {
  const nl = text.indexOf('\n');
  const header = nl === -1 ? text : text.slice(0, nl);

  return header.includes('Letterboxd URI');
}

// Parse YYYY-MM-DD date string → Date (midnight UTC)
function parseYMD(s: string): Date | undefined {
  if (!s) {
    return undefined;
  }

  const d = new Date(`${s}T00:00:00Z`);

  return isNaN(d.getTime()) ? undefined : d;
}

export class LetterboxdFileImporter implements FileImporter {
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
      if (LETTERBOXD_FILES.includes(base) && this.headerMatches(root)) {
        return { confidence: 0.95 };
      }

      if (LETTERBOXD_FILES.includes(base)) {
        return { confidence: 0.8 };
      }

      return { confidence: 0 };
    }

    if (stat.isDirectory()) {
      try {
        const names = fs.readdirSync(root).map((n) => n.toLowerCase());
        const hits = LETTERBOXD_FILES.filter((f) => names.includes(f)).length;
        if (hits >= 1) {
          // Verify header in one of the matching files
          for (const name of fs.readdirSync(root)) {
            if (LETTERBOXD_FILES.includes(name.toLowerCase())) {
              if (this.headerMatches(path.join(root, name))) {
                return { confidence: 0.95 };
              }
            }
          }

          return { confidence: 0.8 };
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

      return headerHasLetterboxdCols(buf.toString('utf8', 0, n));
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

      for (const name of names) {
        if (LETTERBOXD_FILES.includes(name.toLowerCase())) {
          await this.processFile(path.join(root, name), params);
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
    // diary.csv has "Watched Date"; ratings.csv falls back to "Date"
    const ts = parseYMD(row['Watched Date'] || row['Date'] || '');
    if (!timeframeContains(params.timeframe, ts)) {
      return;
    }

    const name = row['Name'] || '';
    const uri = row['Letterboxd URI'] || '';
    // Unique per diary entry (boxd.it/<id>) or per film (ratings.csv); fall back
    // to a composite so same-day films can't collapse if a URI is ever blank.
    const id =
      uri ||
      `letterboxd:${name}:${row['Year'] || ''}:${row['Watched Date'] || row['Date'] || ''}:${row['Rating'] || ''}`;
    params.pipeline.push({
      item: {
        id,
        classification: 'watch',
        timestamp: ts,
        content: { filename: 'watch.txt', mediaType: 'text/plain', data: async () => Buffer.from(name) },
        metadata: {
          Name: name || undefined,
          Year: row['Year'] || undefined,
          Rating: row['Rating'] || undefined,
          Rewatch: row['Rewatch'] || undefined,
          Tags: row['Tags'] || undefined,
          LetterboxdURI: row['Letterboxd URI'] || undefined,
          Source: 'Letterboxd',
        },
      },
    });
  }
}

registerDataSource({
  name: 'letterboxd',
  title: 'Letterboxd',
  icon: '',
  description: 'Film watch history from a Letterboxd CSV export (diary.csv or ratings.csv).',
  newFileImporter: () => new LetterboxdFileImporter(),
});
