/* TikTok — "Download your data" JSON export (user_data_tiktok.json). */
import fs from 'node:fs';
import path from 'node:path';

import { asArray, asRecord, asString, dig, type JsonRecord } from './json';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

const TIKTOK_FILES = ['user_data_tiktok.json', 'user_data.json', 'tiktok.json'];

// "YYYY-MM-DD HH:MM:SS" (UTC, optional trailing " UTC") → Date
function parseTikTokDate(s: string | undefined): Date | undefined {
  if (!s) {
    return undefined;
  }

  const d = new Date(s.replace(/ UTC$/i, '').replace(' ', 'T') + 'Z');

  return isNaN(d.getTime()) ? undefined : d;
}

function looksLikeTikTok(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const o = obj as Record<string, unknown>;

  return 'Activity' in o || 'Direct Messages' in o;
}

function parseFile(fpath: string): JsonRecord | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(fpath, 'utf8');
  } catch {
    return undefined;
  }

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return looksLikeTikTok(obj) ? (obj as JsonRecord) : undefined;
}

export class TikTokFileImporter implements FileImporter {
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
      if (!TIKTOK_FILES.includes(path.basename(root).toLowerCase())) {
        return { confidence: 0 };
      }

      return parseFile(root) ? { confidence: 0.95 } : { confidence: 0 };
    }

    if (stat.isDirectory()) {
      let names: string[];
      try {
        names = fs.readdirSync(root);
      } catch {
        return { confidence: 0, dir_threshold: 0.7 };
      }

      for (const name of names) {
        if (TIKTOK_FILES.includes(name.toLowerCase()) && parseFile(path.join(root, name))) {
          return { confidence: 0.9 };
        }
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

    let filePath: string | undefined;
    try {
      const stat = fs.statSync(root);
      if (stat.isFile()) {
        filePath = root;
      } else if (stat.isDirectory()) {
        for (const name of fs.readdirSync(root)) {
          if (TIKTOK_FILES.includes(name.toLowerCase())) {
            filePath = path.join(root, name);
            break;
          }
        }
      }
    } catch {
      return;
    }

    if (!filePath) {
      params.log?.('warn', 'TikTok: data file not found');

      return;
    }

    let raw: string;
    try {
      raw = await fs.promises.readFile(filePath, 'utf8');
    } catch (e) {
      params.log?.('error', 'Failed to read TikTok export', { error: (e as Error).message });

      return;
    }

    let obj: JsonRecord;
    try {
      obj = JSON.parse(raw);
    } catch {
      return;
    }

    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return;
    }

    this.importWatch(obj, params);
    this.importLikes(obj, params);
    this.importFavorites(obj, params);
    this.importSearch(obj, params);
    this.importComments(obj, params);
    this.importDirectMessages(obj, params);
  }

  private importWatch(obj: JsonRecord, params: ImportParams): void {
    const list = asArray(dig(obj, 'Activity', 'Video Browsing History', 'VideoList'));
    if (!list) {
      return;
    }

    for (const rawEntry of list) {
      const e = asRecord(rawEntry);
      if (!e) {
        continue;
      }

      const ts = parseTikTokDate(asString(e.Date));
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const link = asString(e.Link) || asString(e.VideoLink) || '';
      const id = link.match(/video\/(\d+)/)?.[1];
      params.pipeline.push({
        item: {
          classification: 'watch',
          timestamp: ts,
          content: { filename: 'watch.txt', mediaType: 'text/plain', data: async () => Buffer.from(link) },
          metadata: {
            Title: id ? `TikTok video ${id}` : 'TikTok video',
            URL: link || undefined,
            Kind: 'browse',
            Source: 'TikTok',
          },
        },
      });
    }
  }

  private importLikes(obj: JsonRecord, params: ImportParams): void {
    const list = asArray(dig(obj, 'Activity', 'Like List', 'ItemFavoriteList'));
    if (!list) {
      return;
    }

    for (const rawEntry of list) {
      const e = asRecord(rawEntry);
      if (!e) {
        continue;
      }

      const ts = parseTikTokDate(asString(e.Date));
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const link = asString(e.Link) || asString(e.VideoLink) || '';
      const id = link.match(/video\/(\d+)/)?.[1];
      params.pipeline.push({
        item: {
          classification: 'social',
          timestamp: ts,
          content: { filename: 'like.txt', mediaType: 'text/plain', data: async () => Buffer.from(link) },
          metadata: {
            Title: id ? `TikTok video ${id}` : 'TikTok video',
            URL: link || undefined,
            Kind: 'like',
            Source: 'TikTok',
          },
        },
      });
    }
  }

  private importFavorites(obj: JsonRecord, params: ImportParams): void {
    const list = asArray(dig(obj, 'Activity', 'Favorite Videos', 'FavoriteVideoList'));
    if (!list) {
      return;
    }

    for (const rawEntry of list) {
      const e = asRecord(rawEntry);
      if (!e) {
        continue;
      }

      const ts = parseTikTokDate(asString(e.Date));
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const link = asString(e.Link) || '';
      const id = link.match(/video\/(\d+)/)?.[1];
      params.pipeline.push({
        item: {
          classification: 'social',
          timestamp: ts,
          content: { filename: 'favorite.txt', mediaType: 'text/plain', data: async () => Buffer.from(link) },
          metadata: {
            Title: id ? `TikTok video ${id}` : 'TikTok video',
            URL: link || undefined,
            Kind: 'favorite',
            Source: 'TikTok',
          },
        },
      });
    }
  }

  private importSearch(obj: JsonRecord, params: ImportParams): void {
    const list = asArray(dig(obj, 'Activity', 'Search History', 'SearchList'));
    if (!list) {
      return;
    }

    for (const rawEntry of list) {
      const e = asRecord(rawEntry);
      if (!e) {
        continue;
      }

      const ts = parseTikTokDate(asString(e.Date));
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const term = asString(e.SearchTerm) || '';
      params.pipeline.push({
        item: {
          classification: 'social',
          timestamp: ts,
          content: { filename: 'search.txt', mediaType: 'text/plain', data: async () => Buffer.from(term) },
          metadata: { Text: term || undefined, Query: term || undefined, Kind: 'search', Source: 'TikTok' },
        },
      });
    }
  }

  private importComments(obj: JsonRecord, params: ImportParams): void {
    const list = asArray(dig(obj, 'Comment', 'Comments', 'CommentsList'));
    if (!list) {
      return;
    }

    for (const rawEntry of list) {
      const e = asRecord(rawEntry);
      if (!e) {
        continue;
      }

      const ts = parseTikTokDate(asString(e.Date));
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const comment = asString(e.Comment) || '';
      params.pipeline.push({
        item: {
          classification: 'social',
          timestamp: ts,
          content: {
            filename: 'comment.txt',
            mediaType: 'text/plain',
            data: async () => Buffer.from(comment),
          },
          metadata: {
            Text: comment || undefined,
            Comment: comment || undefined,
            Kind: 'comment',
            Source: 'TikTok',
          },
        },
      });
    }
  }

  private importDirectMessages(obj: JsonRecord, params: ImportParams): void {
    const chats = asRecord(dig(obj, 'Direct Messages', 'Chat History', 'ChatHistory'));
    if (!chats) {
      return;
    }

    for (const [key, arr] of Object.entries(chats)) {
      if (!Array.isArray(arr)) {
        continue;
      }

      const conversation = key.replace(/^Chat History with /, '').replace(/:$/, '');
      for (const rawMsg of arr) {
        const msg = asRecord(rawMsg);
        if (!msg) {
          continue;
        }

        const ts = parseTikTokDate(asString(msg.Date));
        if (!timeframeContains(params.timeframe, ts)) {
          continue;
        }

        const content = asString(msg.Content) || '';
        const sender = asString(msg.From) || undefined;
        // 1:1 export: the conversation key IS the partner; a message whose From
        // equals it is inbound (partner -> me), otherwise outbound (me -> partner).
        const isInbound = sender !== undefined && sender === conversation;
        const to = isInbound ? undefined : conversation || undefined;
        params.pipeline.push({
          item: {
            classification: 'message',
            timestamp: ts,
            content: { filename: 'dm.txt', mediaType: 'text/plain', data: async () => Buffer.from(content) },
            metadata: {
              Sender: sender,
              To: to,
              Direction: sender ? (isInbound ? 'received' : 'sent') : undefined,
              ThreadId: conversation || undefined,
              Conversation: conversation || undefined,
              Kind: 'dm',
              Source: 'TikTok',
              Text: content || undefined,
            },
          },
        });
      }
    }
  }
}

registerDataSource({
  name: 'tiktok',
  title: 'TikTok',
  icon: '',
  description: 'Watch history, likes, favorites, searches, comments, and DMs from a TikTok data export.',
  newFileImporter: () => new TikTokFileImporter(),
});
