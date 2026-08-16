/* Gemini — chat history + Saved Info memories from Google Takeout.
   Chat history lives in "My Activity/Gemini Apps/MyActivity.json". Saved Info
   (Gemini's memory: the facts/preferences the user has told it to remember,
   surfaced to cross-vendor memory portability in Mar 2026) exports as a
   "Saved Info" JSON under the Takeout "Gemini" product folder. Google
   publishes no schema and the file naming varies ("Saved Info.json",
   "saved_info.json", …), so the name match is normalized and the entry
   parsing is shape-tolerant (_ai_memory.ts).

   Media: activity records reference uploaded/generated images through an
   `attachedFiles` list whose bytes Takeout drops next to MyActivity.json
   (same folder or a subfolder). No published schema here either, so entries
   are read tolerantly (bare strings, or objects keyed name/title/fileName)
   and resolved by direct path then a recursive filename search; resolved
   photos/videos become 'media' items attached to their activity record
   (_ai_media.ts), unresolved ones land in the drop ledger. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { insideRoot, mediaAttachmentsFor, mediaItemForAsset } from './_ai_media';
import type { MemoryEntry } from './_ai_memory';
import { parseMemoryEntries, memoryTitle } from './_ai_memory';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, Item } from './timeline';
import { timeframeContains } from './timeline';

interface ActivityRecord {
  header?: string;
  title?: string;
  titleUrl?: string;
  time?: string;
  products?: string[];
  attachedFiles?: unknown;
}

/** Tolerantly read a record's attachedFiles into file names/subpaths. */
function attachedFileNames(record: ActivityRecord): string[] {
  if (!Array.isArray(record.attachedFiles)) {
    return [];
  }

  const names: string[] = [];
  for (const e of record.attachedFiles) {
    if (typeof e === 'string' && e) {
      names.push(e);
    } else if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      const n = o.name ?? o.title ?? o.fileName;
      if (typeof n === 'string' && n) {
        names.push(n);
      }
    }
  }

  return names;
}

const GEMINI_HEADERS = ['Gemini Apps', 'Bard'];

/** True for any spelling of the Saved Info file name ("Saved Info.json",
    "saved_info.json", "SavedInfo.json", "saved-info.json", …). */
function isSavedInfoFilename(name: string): boolean {
  return name.toLowerCase().replace(/[ _-]/g, '') === 'savedinfo.json';
}

function firstRecordHeader(fpath: string): string | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(fpath, 'utf8');
  } catch {
    return undefined;
  }

  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!Array.isArray(arr) || arr.length === 0) {
    return undefined;
  }

  const first = arr[0] as ActivityRecord;

  return first && typeof first === 'object' ? first.header : undefined;
}

function savedInfoParses(fpath: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(fpath, 'utf8');
  } catch {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  return parseMemoryEntries(parsed).length > 0;
}

export class GeminiFileImporter implements FileImporter {
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
      const base = path.basename(root);
      if (base.toLowerCase() === 'myactivity.json') {
        const header = firstRecordHeader(root);

        return header && GEMINI_HEADERS.includes(header) ? { confidence: 0.9 } : { confidence: 0 };
      }

      if (isSavedInfoFilename(base)) {
        return savedInfoParses(root) ? { confidence: 0.85 } : { confidence: 0 };
      }

      return { confidence: 0 };
    }

    if (stat.isDirectory()) {
      const found = this.findFile(root, (n) => n.toLowerCase() === 'myactivity.json');
      if (found && GEMINI_HEADERS.includes(firstRecordHeader(found) ?? '')) {
        return { confidence: 0.9 };
      }

      // A Takeout "Gemini" product folder may hold only Gems + Saved Info,
      // with the chat activity exported (or not) under a separate My Activity
      // tree — recognize the memory file on its own.
      const savedInfo = this.findFile(root, isSavedInfoFilename);
      if (savedInfo && savedInfoParses(savedInfo)) {
        return { confidence: 0.85 };
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

    let activityPath: string | undefined;
    let savedInfoPath: string | undefined;
    try {
      const stat = fs.statSync(root);
      if (stat.isFile()) {
        const base = path.basename(root);
        if (isSavedInfoFilename(base)) {
          savedInfoPath = root;
        } else {
          activityPath = root;
        }
      } else if (stat.isDirectory()) {
        activityPath = this.findFile(root, (n) => n.toLowerCase() === 'myactivity.json');
        savedInfoPath = this.findFile(root, isSavedInfoFilename);
      }
    } catch {
      return;
    }

    if (!activityPath && !savedInfoPath) {
      params.log?.('warn', 'Gemini: MyActivity.json not found');

      return;
    }

    if (activityPath) {
      await this.importActivity(activityPath, params);
    }

    if (savedInfoPath) {
      await this.importSavedInfo(savedInfoPath, params);
    }
  }

  private async importActivity(activityPath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(activityPath, 'utf8');
    } catch (e) {
      params.log?.('error', 'Failed to read Gemini MyActivity.json', { error: (e as Error).message });

      return;
    }

    let arr: ActivityRecord[];
    try {
      arr = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(arr)) {
      return;
    }

    const root = path.dirname(activityPath);
    for (let i = 0; i < arr.length; i++) {
      const record = arr[i];
      if (!record || typeof record !== 'object') {
        continue;
      }

      if (!GEMINI_HEADERS.includes(record.header ?? '')) {
        continue;
      }

      const ts = record.time ? new Date(record.time) : undefined;
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const title = (record.title ?? '').replace(/^Prompted /, '');
      const id =
        'gemini:' +
        crypto
          .createHash('sha1')
          .update(`${record.titleUrl ?? ''}\0${record.time ?? ''}\0${title}\0${i}`)
          .digest('hex')
          .slice(0, 24);
      const media = this.mediaForRecord(record, root, ts, title, params);
      // Media accompanying a prompt rides the message itself (the comms media
      // lane) — attachment sub-items minted duplicate ci.events rows.
      const mediaAttachments = mediaAttachmentsFor(media);
      params.pipeline.push({
        item: {
          id,
          classification: 'message',
          timestamp: ts,
          content: { filename: 'prompt.txt', mediaType: 'text/plain', data: async () => Buffer.from(title) },
          metadata: {
            Prompt: title || undefined,
            // My Activity records are always the user's own prompts.
            Direction: 'outgoing',
            URL: record.titleUrl || undefined,
            Source: 'Gemini',
            Text: title || undefined,
            MediaAttachments: mediaAttachments.length ? mediaAttachments : undefined,
          },
        },
      });
    }
  }

  /** Media items for one record's attachedFiles. Each name resolves by direct
      path under the MyActivity.json folder, then a recursive basename search
      (Takeout has staged Gemini media both flat and under subfolders). */
  private mediaForRecord(
    record: ActivityRecord,
    root: string,
    ts: Date | undefined,
    title: string,
    params: ImportParams,
  ): Item[] {
    const media: Item[] = [];
    for (const name of attachedFileNames(record)) {
      const rel = name.replace(/\\/g, '/');
      let abs: string | undefined = path.join(root, rel);
      let onDisk = false;
      if (insideRoot(root, abs)) {
        try {
          onDisk = fs.statSync(abs).isFile();
        } catch {
          /* absent — fall through */
        }
      }

      if (!onDisk) {
        abs = rel.includes('/') ? undefined : this.findFile(root, (n) => n === rel);
      }

      if (!abs) {
        params.pipeline.drop?.('media_asset_missing', name);
        continue;
      }

      const relKey = path.relative(root, abs).split(path.sep).join('/');
      const item = mediaItemForAsset('gemini:media', 'Gemini', { abs, relKey }, ts, {
        Prompt: title || undefined,
        URL: record.titleUrl || undefined,
      });
      if (item) {
        media.push(item);
      }
    }

    return media;
  }

  private async importSavedInfo(savedInfoPath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(savedInfoPath, 'utf8');
    } catch (e) {
      params.log?.('error', 'Failed to read Gemini Saved Info', { error: (e as Error).message });

      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    for (const m of parseMemoryEntries(parsed)) {
      this.pushMemory(m, params);
    }
  }

  private pushMemory(m: MemoryEntry, params: ImportParams): void {
    const ts = m.created ?? m.updated;
    if (!timeframeContains(params.timeframe, ts)) {
      return;
    }

    const key = m.idHint || crypto.createHash('sha1').update(m.text).digest('hex').slice(0, 24);
    params.pipeline.push({
      item: {
        id: `gemini:memory:${key}`,
        classification: 'note',
        timestamp: ts,
        content: { filename: 'memory.txt', mediaType: 'text/plain', data: async () => Buffer.from(m.text) },
        metadata: {
          Kind: 'memory',
          Title: memoryTitle(m.text),
          Category: m.category || undefined,
          Updated: m.updated || undefined,
          Source: 'Gemini',
          Text: m.text,
        },
      },
    });
  }

  private findFile(dir: string, wanted: (name: string) => boolean): string | undefined {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return undefined;
    }

    for (const name of entries) {
      if (wanted(name)) {
        return path.join(dir, name);
      }
    }

    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isDirectory()) {
          const sub = this.findFile(full, wanted);
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
}

registerDataSource({
  name: 'gemini',
  title: 'Gemini (Google Takeout)',
  icon: '',
  description:
    'Gemini Apps (formerly Bard) chat history and Saved Info memories from a Google Takeout export.',
  newFileImporter: () => new GeminiFileImporter(),
});
