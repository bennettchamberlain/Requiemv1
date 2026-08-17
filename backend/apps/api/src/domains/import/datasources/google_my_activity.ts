/* Google My Activity — per-product MyActivity.html files from a Google Takeout
   "My Activity" export. One file per product (Search, Maps, YouTube, Ads,
   Assistant, Shopping, …). Each activity is an "outer-cell" whose body cell
   ("mdl-typography--body-1") holds an action verb, an optional <a href> target,
   and a trailing timestamp line, e.g.

     Visited <a href="…">Jaron Lanier's Homepage</a><br>Jun 17, 2026, 9:30:52 PM PDT<br>
     Searched for <a href="…?q=Lanier">Lanier</a><br>Jun 17, 2026, 9:30:38 PM PDT<br>
     Explored on Google Maps<br>Jun 18, 2026, 6:59:05 PM PDT<br>

   These files can be hundreds of MB, so we scan the body cells with a regex
   rather than building a DOM. */
import fs from 'node:fs';
import path from 'node:path';

import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, Graph, Metadata } from './timeline';
import { timeframeContains } from './timeline';

// The action body cell of one activity. The text-right variant and the caption
// cell carry no activity text, so we only match the plain body-1 cell.
const BODY_CELL_RE =
  /<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">([\s\S]*?)<\/div>/g;
// First <a href="…">…</a> inside a body cell — the action's primary target.
const FIRST_LINK_RE = /<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/;
// Trailing "Mon DD, YYYY, H:MM:SS AM/PM TZ" timestamp line.
const TIMESTAMP_RE = /([A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2}\s?(?:AM|PM)\s+[A-Z]{2,5})/;

function decodeEntities(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&emsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGoogleDate(s: string | undefined): Date | undefined {
  if (!s) {
    return undefined;
  }

  const d = new Date(s.replace(/\u00A0/g, ' ').trim());

  return isNaN(d.getTime()) ? undefined : d;
}

// Product folder name from a MyActivity.html path: …/My Activity/<Product>/MyActivity.html
function productFor(fpath: string): string {
  return path.basename(path.dirname(fpath)) || 'Activity';
}

function* walkActivityFiles(root: string, depth = 0): Generator<string> {
  if (depth > 4) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      yield* walkActivityFiles(p, depth + 1);
    } else if (e.isFile() && e.name.toLowerCase() === 'myactivity.html') {
      yield p;
    }
  }
}

export class GoogleMyActivityFileImporter implements FileImporter {
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
      if (path.basename(root).toLowerCase() !== 'myactivity.html') {
        return { confidence: 0 };
      }

      // Confirm the body-cell signature so we don't claim arbitrary HTML.
      try {
        const fd = fs.openSync(root, 'r');
        const buf = Buffer.alloc(65536);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);

        return buf.subarray(0, n).includes('mdl-typography--body-1')
          ? { confidence: 0.95 }
          : { confidence: 0 };
      } catch {
        return { confidence: 0 };
      }
    }

    if (stat.isDirectory()) {
      for (const _ of walkActivityFiles(root)) {
        return { confidence: 0.9 };
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

    if (stat.isFile()) {
      await this.processFile(root, params);
    } else if (stat.isDirectory()) {
      for (const f of walkActivityFiles(root)) {
        await this.processFile(f, params);
      }
    }
  }

  private async processFile(fpath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', 'Failed to read MyActivity.html', {
        file: path.basename(fpath),
        error: (e as Error).message,
      });

      return;
    }

    const product = productFor(fpath);
    // index is the per-file parse order, so the stable id stays deterministic
    // across re-imports even when entries share an action, target, and second.
    let index = 0;
    BODY_CELL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BODY_CELL_RE.exec(raw)) !== null) {
      const cellHtml = m[1];
      // The empty text-right body cell appears once per activity; skip it.
      if (!cellHtml.trim()) {
        continue;
      }

      this.pushEntry(cellHtml, product, index++, params);
    }
  }

  private pushEntry(cellHtml: string, product: string, index: number, params: ImportParams): void {
    // Decode first, THEN match/strip the timestamp on the decoded text: the raw
    // HTML separates the date with &nbsp;/<br>, so a raw-matched timestamp string
    // won't substring-match the whitespace-normalised decoded action.
    const decoded = decodeEntities(cellHtml);
    const tsMatch = decoded.match(TIMESTAMP_RE);
    const ts = parseGoogleDate(tsMatch?.[1]);
    if (!timeframeContains(params.timeframe, ts)) {
      return;
    }

    const link = cellHtml.match(FIRST_LINK_RE);
    const url = link ? decodeEntities(link[1]) : undefined;
    const linkText = link ? decodeEntities(link[2]) : undefined;

    // Full body text with the timestamp line stripped → the action phrase
    // ("Visited Jaron Lanier's Homepage", "Searched for Lanier", "Used Assistant").
    let action = decoded;
    if (tsMatch) {
      action = action.replace(tsMatch[1], '').trim();
    }

    // The leading verb phrase before the linked target (e.g. "Searched for").
    const verb = link ? decodeEntities(cellHtml.split(link[0])[0]) : action;

    let classification: string;
    let title: string;
    const metadata: Metadata = {
      Product: product,
      Action: action || undefined,
      Source: 'Google My Activity',
    };

    if (/^Searched for\b/i.test(verb) || /^Searched\b/i.test(action)) {
      classification = 'search';
      const query = linkText || action.replace(/^Searched for\s*/i, '').trim();
      title = query || action || 'Search';
      metadata.Query = query || undefined;
      metadata.Text = query || undefined;
      metadata.Title = title;
      if (url) {
        metadata.URL = url;
      }
    } else if (/^(Visited|Viewed|Watched)\b/i.test(verb) && url) {
      classification = 'page_view';
      title = linkText || action || product;
      metadata.Title = title;
      metadata.URL = url;
    } else {
      // Action-only entries with no target (e.g. "Used Assistant",
      // "Explored on Google Maps") — keep the action text as the title.
      classification = 'page_view';
      title = action || product;
      metadata.Title = title;
      if (url) {
        metadata.URL = url;
      }
    }

    const g: Graph = {
      item: {
        // Stable, deterministic per-file id; index keeps near-duplicate entries
        // distinct so they don't collapse in hashItem (shared filename + bucket).
        id: `gactivity:${product}:${index}`,
        classification,
        timestamp: ts,
        content: { filename: 'activity.txt', mediaType: 'text/plain', data: async () => Buffer.from(title) },
        metadata,
      },
    };
    params.pipeline.push(g);
  }
}

registerDataSource({
  name: 'google_my_activity',
  title: 'Google My Activity',
  icon: '',
  description:
    'Per-product activity (Search, Maps, YouTube, Assistant, …) from a Google Takeout My Activity export.',
  newFileImporter: () => new GoogleMyActivityFileImporter(),
});
