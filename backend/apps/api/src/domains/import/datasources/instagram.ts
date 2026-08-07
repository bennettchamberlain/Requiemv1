/* Instagram — "Download Your Information" export.
 *
 * Supports BOTH formats Meta produces:
 *  - JSON: your_instagram_activity/ with message_*.json + posts JSON.
 *  - HTML: the same tree but rendered as .html (messages/inbox/<thread>/message_*.html,
 *    likes/liked_posts.html, comments/*.html, saved/saved_posts.html, ...).
 *
 * The HTML format has no per-entry <time datetime> attributes for activity logs;
 * each entry block ends with a human-readable date div: <div class="_3-94 _a6-o">May 04, 2026 10:01 am</div>.
 * We split each file's <main> body on that date div and treat the text before each
 * date as one entry. Message files additionally carry a per-entry <h2> sender.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

interface IGMessage {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  share?: { link?: string };
  is_unsent?: boolean;
}
interface IGThread {
  participants?: Array<{ name: string }>;
  messages?: IGMessage[];
  title?: string;
}
interface IGPostMedia {
  uri?: string;
  creation_timestamp?: number;
  title?: string;
}
interface IGPost {
  media?: IGPostMedia[];
  title?: string;
  creation_timestamp?: number;
}

// ---- HTML helpers (dependency-free, mirrors mastodon.ts style) ----

function stripTags(h: string): string {
  return h
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|li|h\d)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
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
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Per-entry date div used across Meta HTML activity logs.
const DATE_DIV_RE = /<div class="_3-94 _a6-o">([^<]*)<\/div>/g;

function parseMetaDate(s: string): Date | undefined {
  const t = decodeHtml(s)
    .replace(/\u202F/g, ' ')
    .trim();
  if (!t) {
    return undefined;
  }

  const d = new Date(t);

  return isNaN(d.getTime()) ? undefined : d;
}

interface HtmlEntry {
  sender?: string;
  text: string;
  ts?: Date;
}

// Split a file's <main> body into one entry per trailing date div.
// The text BEFORE each date div is that entry's content.
function parseHtmlEntries(html: string): HtmlEntry[] {
  const mainIdx = html.indexOf('<main');
  let body = mainIdx >= 0 ? html.slice(mainIdx) : html;
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');

  const entries: HtmlEntry[] = [];
  DATE_DIV_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = DATE_DIV_RE.exec(body)) !== null) {
    const chunk = body.slice(last, m.index);
    last = DATE_DIV_RE.lastIndex;
    const ts = parseMetaDate(m[1]);
    // Per-entry sender (message logs put it in an <h2>).
    let sender: string | undefined;
    const h2 = chunk.match(/<h2[^>]*>([^<]*)<\/h2>/);
    if (h2) {
      const s = decodeHtml(h2[1]).trim();
      if (s) {
        sender = s;
      }
    }

    const text = htmlToText(chunk);
    if (text || ts) {
      entries.push({ sender, text, ts });
    }
  }

  return entries;
}

function readTitle(html: string): string | undefined {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) {
    return undefined;
  }

  const t = decodeHtml(m[1]).trim();

  return t || undefined;
}

// Recursively collect files matching a predicate (bounded; tolerant of bad dirs).
function walkFiles(dir: string, match: (name: string) => boolean, out: string[], depth = 0): void {
  if (depth > 8) {
    return;
  }

  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const d of names) {
    const full = path.join(dir, d.name);
    try {
      if (d.isDirectory()) {
        walkFiles(full, match, out, depth + 1);
      } else if (d.isFile() && match(d.name)) {
        out.push(full);
      }
    } catch {
      /* ignore */
    }
  }
}

function hasHtmlActivity(actRoot: string): boolean {
  const found: string[] = [];
  walkFiles(actRoot, (n) => /\.html$/i.test(n), found, 0);

  return found.length > 0;
}

function hasJsonActivity(actRoot: string): boolean {
  const found: string[] = [];
  walkFiles(actRoot, (n) => /^(message_\d+|post_\d+|posts_\d+)\.json$/i.test(n), found, 0);

  return found.length > 0;
}

export class InstagramFileImporter implements FileImporter {
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

    if (stat.isDirectory()) {
      try {
        const names = fs.readdirSync(root);
        if (names.includes('your_instagram_activity')) {
          return { confidence: 0.95 };
        }

        if (names.includes('personal_information') && names.includes('media')) {
          return { confidence: 0.9 };
        }

        if (names.includes('connections') && names.includes('messages')) {
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

    let stat: fs.Stats;
    try {
      stat = fs.statSync(root);
    } catch {
      return;
    }

    if (!stat.isDirectory()) {
      return;
    }

    const actRoot = fs.existsSync(path.join(root, 'your_instagram_activity'))
      ? path.join(root, 'your_instagram_activity')
      : root;

    // Decide format. Prefer JSON when present; fall back to HTML.
    const jsonPresent = hasJsonActivity(actRoot);
    if (jsonPresent) {
      await this.importJson(actRoot, params);
    }

    // HTML may coexist (or be the only format). Only run it when there is no
    // JSON message/post data, so we never double-import.
    if (!jsonPresent && hasHtmlActivity(actRoot)) {
      await this.importHtml(actRoot, params);
    }
  }

  // ---------- JSON path (unchanged behaviour) ----------

  private async importJson(actRoot: string, params: ImportParams): Promise<void> {
    const inboxDir = path.join(actRoot, 'messages', 'inbox');
    if (fs.existsSync(inboxDir)) {
      let threads: string[] = [];
      try {
        threads = fs.readdirSync(inboxDir);
      } catch {
        /* ignore */
      }

      for (const thread of threads) {
        const threadDir = path.join(inboxDir, thread);
        try {
          if (!fs.statSync(threadDir).isDirectory()) {
            continue;
          }
        } catch {
          continue;
        }

        let msgFiles: string[] = [];
        try {
          msgFiles = fs
            .readdirSync(threadDir)
            .filter((f) => /^message_\d+\.json$/i.test(f))
            .sort();
        } catch {
          /* ignore */
        }

        for (const mf of msgFiles) {
          await this.processThread(path.join(threadDir, mf), params);
        }
      }
    }

    const postsDir = path.join(actRoot, 'posts');
    if (fs.existsSync(postsDir)) {
      let postFiles: string[] = [];
      try {
        postFiles = fs.readdirSync(postsDir).filter((f) => /^(post_\d+|posts_\d+)\.json$/i.test(f));
      } catch {
        /* ignore */
      }

      for (const pf of postFiles) {
        await this.processPosts(path.join(postsDir, pf), params);
      }
    }
  }

  private async processThread(fpath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', `Failed to read ${path.basename(fpath)}`, { error: (e as Error).message });

      return;
    }

    let thread: IGThread;
    try {
      thread = JSON.parse(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${path.basename(fpath)}`, { error: (e as Error).message });

      return;
    }

    // Recipient/direction signal: the roster is participants[]; Instagram names the
    // thread after the OTHER party, so the owner is the participant that is NOT the title.
    const names = (thread.participants ?? []).map((p) => p.name).filter(Boolean);
    const owner = names.length === 2 ? names.find((n) => n !== thread.title) : undefined;
    for (const msg of thread.messages ?? []) {
      if (msg.is_unsent) {
        continue;
      }

      const ts = msg.timestamp_ms ? new Date(msg.timestamp_ms) : undefined;
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const text = msg.content ?? msg.share?.link ?? '';
      const to = names.filter((n) => n !== msg.sender_name);
      params.pipeline.push({
        item: {
          classification: 'message',
          timestamp: ts,
          content: {
            filename: path.basename(fpath),
            mediaType: 'text/plain',
            data: async () => Buffer.from(text),
          },
          metadata: {
            Sender: msg.sender_name || undefined,
            To: to.length ? to.join(', ') : undefined,
            ...(owner ? { 'From Me': msg.sender_name === owner } : {}),
            Conversation: thread.title || undefined,
            Source: 'Instagram',
            Text: text || undefined,
          },
        },
      });
    }
  }

  private async processPosts(fpath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', `Failed to read ${path.basename(fpath)}`, { error: (e as Error).message });

      return;
    }

    let posts: IGPost[];
    try {
      posts = JSON.parse(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${path.basename(fpath)}`, { error: (e as Error).message });

      return;
    }

    if (!Array.isArray(posts)) {
      return;
    }

    for (const post of posts) {
      const tsRaw = post.creation_timestamp ?? post.media?.[0]?.creation_timestamp;
      const ts = tsRaw ? new Date(tsRaw * 1000) : undefined;
      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const caption = post.title ?? post.media?.[0]?.title ?? '';
      params.pipeline.push({
        item: {
          classification: 'social',
          timestamp: ts,
          content: { filename: 'post.txt', mediaType: 'text/plain', data: async () => Buffer.from(caption) },
          metadata: {
            Text: caption || undefined,
            Title: caption || undefined,
            Caption: caption || undefined,
            Source: 'Instagram',
          },
        },
      });
    }
  }

  // ---------- HTML path ----------

  private async importHtml(actRoot: string, params: ImportParams): Promise<void> {
    // 1) DMs: messages/inbox/<thread>/message_*.html and message_requests/<thread>/message_*.html
    for (const sub of ['inbox', 'message_requests']) {
      const dir = path.join(actRoot, 'messages', sub);
      if (!fs.existsSync(dir)) {
        continue;
      }

      const files: string[] = [];
      walkFiles(dir, (n) => /^message_\d+\.html$/i.test(n), files, 0);
      for (const f of files.sort()) {
        await this.processHtmlMessages(f, actRoot, params);
      }
    }

    // 2) Likes -> 'like'
    await this.processHtmlActivity(
      path.join(actRoot, 'likes', 'liked_posts.html'),
      'like',
      'Instagram like',
      params,
    );
    await this.processHtmlActivity(
      path.join(actRoot, 'likes', 'liked_comments.html'),
      'like',
      'Instagram like',
      params,
    );

    // 3) Comments -> 'comment'
    const commentsDir = path.join(actRoot, 'comments');
    if (fs.existsSync(commentsDir)) {
      const cfiles: string[] = [];
      walkFiles(commentsDir, (n) => /\.html$/i.test(n), cfiles, 0);
      for (const f of cfiles.sort()) {
        await this.processHtmlActivity(f, 'comment', 'Instagram comment', params);
      }
    }

    // 4) Saved -> 'interaction'
    await this.processHtmlActivity(
      path.join(actRoot, 'saved', 'saved_posts.html'),
      'interaction',
      'Instagram saved',
      params,
    );
    await this.processHtmlActivity(
      path.join(actRoot, 'saved', 'saved_collections.html'),
      'interaction',
      'Instagram saved collection',
      params,
    );

    // 5) Media -> profile photos, reposts, other content
    await this.processHtmlActivity(
      path.join(actRoot, 'media', 'profile_photos.html'),
      'photo',
      'Instagram profile photo',
      params,
    );
    await this.processHtmlActivity(
      path.join(actRoot, 'media', 'reposts.html'),
      'social',
      'Instagram repost',
      params,
    );
    await this.processHtmlActivity(
      path.join(actRoot, 'media', 'other_content.html'),
      'media',
      'Instagram media',
      params,
    );

    // 6) Shopping -> checkout/payment info, recently viewed items
    await this.processHtmlActivity(
      path.join(actRoot, 'shopping', 'checkout_payment_information.html'),
      'purchase',
      'Instagram checkout',
      params,
    );
    await this.processHtmlActivity(
      path.join(actRoot, 'shopping', 'recently_viewed_items.html'),
      'page_view',
      'Instagram recently viewed',
      params,
    );

    // 7) Story interactions -> stories viewed
    await this.processHtmlActivity(
      path.join(actRoot, 'story_interactions', 'stories_viewed.html'),
      'interaction',
      'Instagram story viewed',
      params,
    );

    // 8) Connections -> followers & following. Meta ships one or more numbered
    // followers_<n>.html files (split when the list is large) plus a single
    // following.html; both live under connections/followers_and_following/.
    const connectionsDir = path.join(actRoot, 'connections', 'followers_and_following');
    if (fs.existsSync(connectionsDir)) {
      const followerFiles: string[] = [];
      walkFiles(connectionsDir, (n) => /^followers(_\d+)?\.html$/i.test(n), followerFiles, 0);
      for (const f of followerFiles.sort()) {
        await this.processHtmlActivity(f, 'interaction', 'Instagram follower', params);
      }

      const followingFiles: string[] = [];
      walkFiles(connectionsDir, (n) => /^following(_\d+)?\.html$/i.test(n), followingFiles, 0);
      for (const f of followingFiles.sort()) {
        await this.processHtmlActivity(f, 'interaction', 'Instagram following', params);
      }
    }
  }

  private async processHtmlMessages(fpath: string, actRoot: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', `Failed to read ${path.basename(fpath)}`, { error: (e as Error).message });

      return;
    }

    let entries: HtmlEntry[];
    let conversation: string | undefined;
    try {
      conversation = readTitle(raw);
      entries = parseHtmlEntries(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${path.basename(fpath)}`, { error: (e as Error).message });

      return;
    }

    const threadKey = path.relative(actRoot, fpath);
    for (const [i, ent] of entries.entries()) {
      if (!timeframeContains(params.timeframe, ent.ts)) {
        continue;
      }

      // Drop the sender line from the body text if it leads the chunk.
      let text = ent.text;
      if (ent.sender && text.startsWith(ent.sender)) {
        text = text.slice(ent.sender.length).trim();
      }

      if (!text) {
        continue;
      }

      params.pipeline.push({
        item: {
          id: `instagram:msg:${threadKey}#${i}`,
          classification: 'message',
          timestamp: ent.ts,
          content: {
            filename: path.basename(fpath),
            mediaType: 'text/plain',
            data: async () => Buffer.from(text),
          },
          metadata: {
            Sender: ent.sender || undefined,
            To: conversation && conversation !== ent.sender ? conversation : undefined,
            Conversation: conversation || undefined,
            Source: 'Instagram',
            Text: text || undefined,
          },
        },
      });
    }
  }

  private async processHtmlActivity(
    fpath: string,
    classification: string,
    label: string,
    params: ImportParams,
  ): Promise<void> {
    if (!fs.existsSync(fpath)) {
      return;
    }

    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', `Failed to read ${path.basename(fpath)}`, { error: (e as Error).message });

      return;
    }

    let entries: HtmlEntry[];
    try {
      entries = parseHtmlEntries(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${path.basename(fpath)}`, { error: (e as Error).message });

      return;
    }

    for (const [i, ent] of entries.entries()) {
      if (!timeframeContains(params.timeframe, ent.ts)) {
        continue;
      }

      const text = ent.text;
      if (!text) {
        continue;
      }

      params.pipeline.push({
        item: {
          id: `instagram:${path.basename(fpath)}#${i}`,
          classification,
          timestamp: ent.ts,
          content: {
            filename: path.basename(fpath),
            mediaType: 'text/plain',
            data: async () => Buffer.from(text),
          },
          metadata: { Type: label, Source: 'Instagram' },
        },
      });
    }
  }
}

registerDataSource({
  name: 'instagram',
  title: 'Instagram',
  icon: '',
  description: 'DMs, posts, stories, follows, likes — everything in an Instagram DYI export (JSON or HTML).',
  newFileImporter: () => new InstagramFileImporter(),
});
