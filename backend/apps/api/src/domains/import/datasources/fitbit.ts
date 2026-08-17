/* Fitbit — sleep records from a Google Takeout Fitbit export.
   Takeout ships Fitbit data inside a "Fitbit/" folder (often nested under
   "Fitbit/Global Export Data/"). The sleep logs are JSON files named
   "sleep-YYYY-MM-DD.json", each an array of records like:
     { "logId": ..., "dateOfSleep": "2023-01-15",
       "startTime": "2023-01-14T23:00:00.000",
       "endTime": "2023-01-15T07:00:00.000",
       "minutesAsleep": 420, "minutesAwake": 30,
       "efficiency": 92, "duration": 28800000 }
   One 'sleep' event per record. Other Fitbit json files are ignored.
   Note: the Fitbit export format varies; this targets the documented sleep export.

   This source is also the one the wizard presents as "Fitbit / Google Fit",
   because since the 2021 acquisition ONE Takeout "Fit" export carries both:
   Fitbit's "Fitbit/" sleep logs and Google Fit's "Fit/" activity tree. An
   account that never owned a Fitbit has only the latter, so the Google Fit half
   is delegated to GoogleFitFileImporter rather than left unread — dropping such
   an export here used to import nothing and still report success.
*/
import fs from 'node:fs';
import path from 'node:path';

import { GoogleFitFileImporter } from './google_fit';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { Graph, ImportParams } from './timeline';
import { timeframeContains } from './timeline';

const SLEEP_FILE_RE = /^sleep-\d{4}-\d{2}-\d{2}\.json$/i;
const MAX_DEPTH = 3; // recurse a few levels for Fitbit/Global Export Data/ nesting
// Confidence for an export holding only the Google Fit half. Deliberately below
// GoogleFitFileImporter's own 0.95 so the dedicated Google Fit source still
// ranks first in drag-and-drop suggestions — this claim exists to stop a silent
// no-op, not to outrank the source that owns the format.
const GOOGLE_FIT_CONFIDENCE = 0.75;

interface SleepRecord {
  logId?: number | string;
  dateOfSleep?: string;
  startTime?: string;
  endTime?: string;
  minutesAsleep?: number;
  minutesAwake?: number;
  efficiency?: number;
  duration?: number;
}

function readJson(fpath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(fpath, 'utf8');
  } catch {
    return undefined;
  }

  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  } // strip UTF-8 BOM

  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// A parsed value looks like a Fitbit sleep export when it is a non-empty array
// whose first element carries a "minutesAsleep" or "dateOfSleep" field.
function isSleepExport(parsed: unknown): boolean {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return false;
  }

  const first = parsed[0];
  if (!first || typeof first !== 'object') {
    return false;
  }

  const rec = first as SleepRecord;

  return 'minutesAsleep' in rec || 'dateOfSleep' in rec;
}

// Find sleep-*.json files by name within a directory tree (bounded depth).
function findSleepFiles(dir: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      findSleepFiles(full, depth + 1, out);
    } else if (e.isFile() && SLEEP_FILE_RE.test(e.name)) {
      out.push(full);
    }
  }
}

/**
 * Re-label everything an inner importer pushes as belonging to `dataSource`.
 * The delegated importer has no idea it is running under another source's job,
 * so the stamp goes on here, on the way out. Persistence then attributes AND
 * dedups those records under that name — so the same Takeout arriving later
 * through the Google card collides with them instead of being filed twice.
 */
function attributeTo(params: ImportParams, dataSource: string): ImportParams {
  const stamp = (g: Graph): Graph => {
    if (g.item && !g.item.dataSource) {
      g.item.dataSource = dataSource;
    }

    for (const edge of g.edges ?? []) {
      stamp(edge.to);
    }

    return g;
  };

  return {
    ...params,
    pipeline: {
      ...params.pipeline,
      push: (g: Graph) => params.pipeline.push(stamp(g)),
    },
  };
}

export class FitbitFileImporter implements FileImporter {
  // The Google Fit half of the same Takeout "Fit" export. A pure-Fitbit tree
  // makes this a no-op (it finds none of the Fit subfolders), so it costs
  // nothing to always consult.
  private readonly googleFit = new GoogleFitFileImporter();

  async recognize(ctx: unknown, entry: DirEntry): Promise<Recognition> {
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
      if (!SLEEP_FILE_RE.test(path.basename(root))) {
        return { confidence: 0 };
      }

      return isSleepExport(readJson(root)) ? { confidence: 0.95 } : { confidence: 0 };
    }

    if (stat.isDirectory()) {
      const found: string[] = [];
      findSleepFiles(root, 0, found);
      for (const f of found) {
        if (isSleepExport(readJson(f))) {
          return { confidence: 0.9 };
        }
      }

      // No Fitbit sleep logs — but a Takeout "Fit" export with only the Google
      // Fit half still belongs to this card. Claim it (below Google Fit's own
      // confidence) so the import resolves a root instead of importing nothing.
      const gfit = await this.googleFit.recognize(ctx, entry);
      if (gfit.confidence > 0) {
        return { confidence: GOOGLE_FIT_CONFIDENCE };
      }

      return { confidence: 0, dir_threshold: 0.7 };
    }

    return { confidence: 0 };
  }

  async fileImport(ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
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

    const files: string[] = [];
    if (stat.isFile()) {
      if (SLEEP_FILE_RE.test(path.basename(root))) {
        files.push(root);
      }
    } else if (stat.isDirectory()) {
      findSleepFiles(root, 0, files);
    }

    for (const fpath of files) {
      await this.processFile(fpath, params);
    }

    // Then the Google Fit half of the same export: daily metrics and workouts.
    // Directories only — a lone sleep-*.json has no Fit tree around it. The two
    // halves are disjoint (sleep JSON under Fitbit/ vs the Fit/ subfolders), so
    // nothing is read twice. Those records are Google Fit's, not Fitbit's, so
    // they are attributed to google_fit — only the sleep logs above are Fitbit
    // data. This keeps `data_source` describing where a record came FROM rather
    // than which card happened to import it.
    if (stat.isDirectory()) {
      await this.googleFit.fileImport(ctx, entry, attributeTo(params, 'google_fit'));
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

    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    } // strip UTF-8 BOM

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${base}`, { error: (e as Error).message });

      return;
    }

    if (!Array.isArray(parsed)) {
      return;
    }

    for (const rec of parsed) {
      try {
        this.pushRecord(rec as SleepRecord, params);
      } catch (e) {
        params.log?.('error', `Failed to import sleep record in ${base}`, { error: (e as Error).message });
      }
    }
  }

  private pushRecord(rec: SleepRecord, params: ImportParams): void {
    if (!rec || typeof rec !== 'object') {
      return;
    }

    let ts: Date | undefined;
    if (rec.startTime) {
      const d = new Date(rec.startTime);
      if (!isNaN(d.getTime())) {
        ts = d;
      }
    }

    if (!timeframeContains(params.timeframe, ts)) {
      return;
    }

    const minutesAsleep = typeof rec.minutesAsleep === 'number' ? rec.minutesAsleep : undefined;
    const minutesAwake = typeof rec.minutesAwake === 'number' ? rec.minutesAwake : undefined;
    const efficiency = typeof rec.efficiency === 'number' ? rec.efficiency : undefined;

    const summary = `Slept ${minutesAsleep ?? '?'} min` + (rec.dateOfSleep ? ` on ${rec.dateOfSleep}` : '');

    params.pipeline.push({
      item: {
        classification: 'sleep',
        timestamp: ts,
        content: { filename: 'sleep.txt', mediaType: 'text/plain', data: async () => Buffer.from(summary) },
        metadata: {
          Title: summary,
          'Minutes Asleep': minutesAsleep,
          'Minutes Awake': minutesAwake,
          Efficiency: efficiency,
          'Date Of Sleep': rec.dateOfSleep || undefined,
          Source: 'Fitbit',
        },
      },
    });
  }
}

registerDataSource({
  name: 'fitbit',
  title: 'Fitbit',
  icon: '',
  description: 'Sleep records from a Fitbit export (via Google Takeout Fitbit/ JSON).',
  newFileImporter: () => new FitbitFileImporter(),
});
