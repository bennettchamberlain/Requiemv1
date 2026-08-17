/* Mastodon — ActivityPub account export (outbox.json).
   The export is an ActivityPub OrderedCollection whose `orderedItems` holds the
   user's activities. We emit one 'post' event per "Create" activity wrapping a
   "Note" object; "Announce" activities (boosts) are skipped. The presence of an
   `orderedItems` array (and a corroborating actor.json alongside it) is what
   disambiguates a Mastodon export from other JSON exports.
*/
import fs from 'node:fs';
import path from 'node:path';

import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

interface ActivityObject {
  type?: string;
  content?: string;
  url?: string;
  summary?: string | null;
}

interface Activity {
  type?: string;
  published?: string;
  object?: ActivityObject | string;
}

interface Outbox {
  '@context'?: unknown;
  orderedItems?: unknown;
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
  }

  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// A parsed value is a Mastodon outbox when it is an object carrying an
// `orderedItems` array (the ActivityPub OrderedCollection contract).
function isOutbox(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }

  return Array.isArray((parsed as Outbox).orderedItems);
}

function stripTags(h: string): string {
  // Turn block/line breaks into newlines first so paragraph structure survives.
  return h
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

function decodeHtml(h: string): string {
  return h
    .replace(/&#x([0-9a-fA-F]+);/g, (_, d) => String.fromCharCode(parseInt(d, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function htmlToText(html: string): string {
  return decodeHtml(stripTags(html))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class MastodonFileImporter implements FileImporter {
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
      if (path.basename(root).toLowerCase() !== 'outbox.json') {
        return { confidence: 0 };
      }

      return isOutbox(readJson(root)) ? { confidence: 0.95 } : { confidence: 0 };
    }

    if (stat.isDirectory()) {
      const names = (() => {
        try {
          return fs.readdirSync(root);
        } catch {
          return [];
        }
      })();
      const outbox = names.find((n) => n.toLowerCase() === 'outbox.json');
      if (outbox && isOutbox(readJson(path.join(root, outbox)))) {
        // actor.json sitting beside outbox.json is a strong corroborating signal.
        const hasActor = names.some((n) => n.toLowerCase() === 'actor.json');

        return { confidence: hasActor ? 0.97 : 0.9 };
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

    let fpath: string | undefined;
    if (stat.isFile()) {
      fpath = root;
    } else if (stat.isDirectory()) {
      const match = (() => {
        try {
          return fs.readdirSync(root);
        } catch {
          return [];
        }
      })().find((n) => n.toLowerCase() === 'outbox.json');
      if (match) {
        fpath = path.join(root, match);
      }
    }

    if (!fpath) {
      return;
    }

    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', 'Failed to read Mastodon outbox.json', { error: (e as Error).message });

      return;
    }

    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      params.log?.('error', 'Failed to parse Mastodon outbox.json', { error: (e as Error).message });

      return;
    }

    if (!isOutbox(parsed)) {
      return;
    }

    const items = (parsed as Outbox).orderedItems as unknown[];
    for (const it of items) {
      try {
        this.pushActivity(it as Activity, params);
      } catch (e) {
        params.log?.('error', 'Failed to import Mastodon activity', { error: (e as Error).message });
      }
    }
  }

  private pushActivity(act: Activity, params: ImportParams): void {
    if (!act || typeof act !== 'object') {
      return;
    }

    if (act.type !== 'Create') {
      return;
    } // skip "Announce" (boosts) and others

    const obj = act.object;
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (obj.type !== 'Note') {
      return;
    }

    let ts: Date | undefined = act.published ? new Date(act.published) : undefined;
    if (ts && isNaN(ts.getTime())) {
      ts = undefined;
    }

    if (!timeframeContains(params.timeframe, ts)) {
      return;
    }

    const text = htmlToText(obj.content || '');

    params.pipeline.push({
      item: {
        classification: 'post',
        timestamp: ts,
        content: {
          filename: 'post.txt',
          mediaType: 'text/plain',
          data: async () => Buffer.from(text),
        },
        metadata: {
          Source: 'Mastodon',
          URL: obj.url || undefined,
          Text: text || undefined,
          'Content Warning': obj.summary != null && obj.summary !== '' ? obj.summary : undefined,
        },
      },
    });
  }
}

registerDataSource({
  name: 'mastodon',
  title: 'Mastodon',
  icon: '',
  description: 'Posts from a Mastodon ActivityPub export (outbox.json).',
  newFileImporter: () => new MastodonFileImporter(),
});
