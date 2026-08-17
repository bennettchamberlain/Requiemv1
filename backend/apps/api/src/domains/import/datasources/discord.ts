/* Discord — "Request all of my data" package.
 * Older packages: messages/<channel>/messages.csv (header ID,Timestamp,Contents,Attachments).
 * Current packages: Messages/<channel>/messages.json (array of {ID,Timestamp,Contents,Attachments}),
 * plus Messages/index.json mapping channel ids to display names. */
import fs from 'node:fs';
import path from 'node:path';

import { parseCSV } from './csv';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

const DISCORD_HEADER = 'ID,Timestamp,Contents,Attachments';
const MESSAGE_FILES = ['messages.csv', 'messages.json'];

// Message IDs are snowflakes above Number.MAX_SAFE_INTEGER; quote them before
// JSON.parse so they don't lose precision (and possibly collide) as doubles.
function parseMessagesJSON(text: string): Record<string, string>[] {
  const quoted = text.replace(/"ID"\s*:\s*(\d+)/g, '"ID":"$1"');
  const parsed = JSON.parse(quoted) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const o: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) {
        o[k] = v == null ? '' : String(v);
      }

      return o;
    });
}

function looksLikeMessagesJSON(text: string): boolean {
  try {
    const rows = parseMessagesJSON(text);

    return rows.length > 0 && rows.every((r) => 'ID' in r && 'Timestamp' in r && 'Contents' in r);
  } catch {
    return false;
  }
}

// Timestamps in JSON packages are UTC but zone-less ("2022-08-03 17:55:02");
// pin them to UTC instead of letting Date parse them as local time.
function parseTimestamp(s: string | undefined): Date | undefined {
  if (!s) {
    return undefined;
  }

  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(s.trim());
  const d = new Date(m ? `${m[1]}T${m[2]}Z` : s);

  return isNaN(d.getTime()) ? undefined : d;
}

function findMessageFile(channelDir: string): string | null {
  for (const name of MESSAGE_FILES) {
    const p = path.join(channelDir, name);
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

// Package folder casing differs across export eras ("messages" vs "Messages",
// "account" vs "Account") — look children up case-insensitively.
function findChildDir(dir: string, name: string): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }

  for (const n of names) {
    if (n.toLowerCase() !== name.toLowerCase()) {
      continue;
    }

    const p = path.join(dir, n);
    try {
      if (fs.statSync(p).isDirectory()) {
        return p;
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

function findMessagesDir(root: string): string | null {
  return findChildDir(root, 'messages');
}

/**
 * channel.json `type` is a string in current packages ('DM', 'GROUP_DM',
 * 'GUILD_TEXT', ...) and the numeric Discord API enum in old ones
 * (1 = DM, 3 = GROUP_DM).
 */
function channelKind(type: unknown): 'dm' | 'group_dm' | 'other' {
  if (type === 'DM' || type === 1) {
    return 'dm';
  }

  if (type === 'GROUP_DM' || type === 3) {
    return 'group_dm';
  }

  return 'other';
}

/** Everything a channel needs beyond its own folder, loaded once per import. */
interface PackageContext {
  /** Messages/index.json: channel id → display name (or null / "None"). */
  channelNames: Record<string, string | null>;
  /** Account/user.json relationships: friend user id → best display name. */
  friends: Map<string, string>;
  /** The package owner's own user id (excluded from recipients). */
  selfId?: string;
  /** The package owner's display name — every message's From (the export only
   *  contains the owner's own messages). */
  selfName?: string;
}

const EMPTY_CONTEXT: PackageContext = { channelNames: {}, friends: new Map() };

/**
 * Load Account/user.json for the self id + display name and the friends map —
 * the only per-user-id name source in the package. `relationships` covers
 * current friends only; anyone else stays an opaque snowflake id.
 */
function loadAccountContext(packageRoot: string): {
  friends: Map<string, string>;
  selfId?: string;
  selfName?: string;
} {
  const friends = new Map<string, string>();
  const accountDir = findChildDir(packageRoot, 'account');
  if (!accountDir) {
    return { friends };
  }

  try {
    const u = JSON.parse(fs.readFileSync(path.join(accountDir, 'user.json'), 'utf8')) as {
      id?: unknown;
      username?: unknown;
      global_name?: unknown;
      relationships?: Array<{
        id?: unknown;
        nickname?: unknown;
        user?: { username?: unknown; global_name?: unknown };
      }>;
    };
    for (const r of u.relationships ?? []) {
      const id = r?.id != null ? String(r.id) : '';
      const name = [r?.nickname, r?.user?.global_name, r?.user?.username].find(
        (v): v is string => typeof v === 'string' && v.length > 0,
      );
      if (id && name) {
        friends.set(id, name);
      }
    }

    const selfName = [u.global_name, u.username].find(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );

    return {
      friends,
      selfId: u.id != null ? String(u.id) : undefined,
      ...(selfName ? { selfName } : {}),
    };
  } catch {
    return { friends };
  }
}

const DM_INDEX_PREFIX = 'Direct Message with ';

// Discord renders legacy discriminators as a "#<number>" suffix ("uporter#0",
// "someuser#0000") — an identifier artifact, not part of the username.
function stripDiscriminator(name: string): string {
  return name.replace(/#\d+$/, '').trim();
}

/**
 * Recipient names for participants_metadata.to. Only names, never bare ids:
 *  - 1:1 DM: the handle from the index.json entry ("Direct Message with X"),
 *    falling back to the friends map when the index name is unusable.
 *  - Group DM: each recipient resolved through the friends map; strangers
 *    (id-only) are omitted.
 *  - Guild channels / threads / unknown: none — the channel is a place, not
 *    a set of people.
 */
function participantsFor(
  kind: 'dm' | 'group_dm' | 'other',
  indexName: string | null | undefined,
  recipients: unknown,
  ctx: PackageContext,
): string[] {
  if (kind === 'other') {
    return [];
  }

  const others = (Array.isArray(recipients) ? recipients : [])
    .filter((r): r is string => typeof r === 'string' && /^\d+$/.test(r))
    .filter((r) => r !== ctx.selfId);
  if (kind === 'dm' && indexName?.startsWith(DM_INDEX_PREFIX)) {
    const handle = stripDiscriminator(indexName.slice(DM_INDEX_PREFIX.length).trim());
    if (handle && !handle.includes('Unknown Participant')) {
      return [handle];
    }
  }

  const resolved: string[] = [];
  for (const id of others) {
    const name = stripDiscriminator(ctx.friends.get(id) ?? '');
    if (name && !resolved.includes(name)) {
      resolved.push(name);
    }
  }

  return resolved;
}

// True when this directory directly contains channel-id subfolders each with a messages file.
function hasChannelSubdirs(dir: string): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }

  for (const name of names) {
    const sub = path.join(dir, name);
    try {
      if (!fs.statSync(sub).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    if (findMessageFile(sub)) {
      return true;
    }
  }

  return false;
}

export class DiscordFileImporter implements FileImporter {
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
      try {
        if (base === 'messages.csv') {
          // A lone messages.csv whose header is exactly ID,Timestamp,Contents,Attachments.
          const raw = fs.readFileSync(root, 'utf8');
          const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? '';
          if (firstLine === DISCORD_HEADER) {
            return { confidence: 0.8 };
          }
        } else if (base === 'messages.json') {
          if (looksLikeMessagesJSON(fs.readFileSync(root, 'utf8'))) {
            return { confidence: 0.8 };
          }
        }
      } catch {
        /* ignore */
      }

      return { confidence: 0 };
    }

    if (stat.isDirectory()) {
      try {
        const messagesDir = findMessagesDir(root);
        if (messagesDir && hasChannelSubdirs(messagesDir)) {
          return { confidence: 0.9 };
        }

        if (hasChannelSubdirs(root)) {
          return { confidence: 0.85 };
        }
      } catch {
        /* ignore */
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
      if (MESSAGE_FILES.includes(path.basename(root).toLowerCase())) {
        await this.processChannel(path.dirname(root), params, EMPTY_CONTEXT);
      }

      return;
    }

    if (!stat.isDirectory()) {
      return;
    }

    // Locate the messages dir (root/[Mm]essages if it exists, else root itself).
    const messagesDir = findMessagesDir(root) ?? root;

    // Current packages ship an index.json mapping channel ids to display names —
    // the only place DM channels get a human-readable name.
    let channelNames: Record<string, string | null> = {};
    try {
      const idx = JSON.parse(await fs.promises.readFile(path.join(messagesDir, 'index.json'), 'utf8'));
      if (idx && typeof idx === 'object' && !Array.isArray(idx)) {
        channelNames = idx;
      }
    } catch {
      /* no index.json in old packages */
    }

    // Account/ sits beside Messages/ in a full package; when the user selected
    // the messages dir itself, look one level up for it.
    const packageRoot = messagesDir === root ? path.dirname(root) : root;
    const ctx: PackageContext = { channelNames, ...loadAccountContext(packageRoot) };

    let names: string[];
    try {
      names = fs.readdirSync(messagesDir);
    } catch (e) {
      params.log?.('error', 'Failed to read Discord messages dir', { error: (e as Error).message });

      return;
    }

    for (const name of names) {
      const sub = path.join(messagesDir, name);
      try {
        if (!fs.statSync(sub).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      if (findMessageFile(sub)) {
        await this.processChannel(sub, params, ctx);
      }
    }
  }

  private async processChannel(channelDir: string, params: ImportParams, ctx: PackageContext): Promise<void> {
    const dirId = path.basename(channelDir).replace(/^c/i, '');
    // Optional channel.json for the channel id, kind, recipients, and (in old
    // packages) a display name.
    let channelId = dirId;
    let jsonName: string | undefined;
    let kind: 'dm' | 'group_dm' | 'other' = 'other';
    let recipients: unknown;
    try {
      const cjPath = path.join(channelDir, 'channel.json');
      if (fs.existsSync(cjPath)) {
        const cj = JSON.parse(await fs.promises.readFile(cjPath, 'utf8')) as {
          id?: string;
          name?: string;
          type?: unknown;
          recipients?: unknown;
        };
        if (cj.id) {
          channelId = String(cj.id);
        }

        jsonName = cj.name;
        kind = channelKind(cj.type);
        recipients = cj.recipients;
      }
    } catch {
      /* ignore malformed channel.json */
    }

    // index.json is Python-generated and writes the literal string "None" for unnamed channels.
    const rawIdxName = ctx.channelNames[channelId];
    const idxName = rawIdxName && rawIdxName !== 'None' ? rawIdxName : undefined;
    const channelName = idxName || jsonName || `Channel ${channelId}`;
    const participants = participantsFor(kind, idxName, recipients, ctx);

    const msgPath = findMessageFile(channelDir);
    if (!msgPath) {
      return;
    }

    let raw: string;
    try {
      raw = await fs.promises.readFile(msgPath, 'utf8');
    } catch (e) {
      params.log?.('error', 'Failed to read Discord messages file', { error: (e as Error).message });

      return;
    }

    let rows: Record<string, string>[];
    if (msgPath.endsWith('.json')) {
      try {
        rows = parseMessagesJSON(raw);
      } catch (e) {
        params.log?.('error', 'Failed to parse Discord messages.json', { error: (e as Error).message });

        return;
      }
    } else {
      // Don't trim cells: message Contents whitespace is preserved verbatim.
      rows = parseCSV(raw, { trimValues: false });
    }

    for (const [i, row] of rows.entries()) {
      const contents = row.Contents ?? '';
      const attachments = row.Attachments?.trim() ?? '';
      // An attachment-only message (an image posted with no caption) still gets
      // a communication row: its uploads ARE the payload. The row's content and
      // subject end up empty, and the ci.content rows over the links ride in the
      // attachments column — see mapping.ts discordAttachmentUrls.
      if (!contents && !attachments) {
        continue;
      }

      const safeTs = parseTimestamp(row.Timestamp);
      if (!timeframeContains(params.timeframe, safeTs)) {
        continue;
      }

      const rowId = (row.ID || '').trim();
      params.pipeline.push({
        item: {
          id: rowId ? `discord:${rowId}` : `discord:${path.basename(channelDir)}:${i}`,
          classification: 'message',
          timestamp: safeTs,
          content: {
            filename: 'message.txt',
            mediaType: 'text/plain',
            data: async () => Buffer.from(contents),
          },
          metadata: {
            Conversation: channelName,
            // Recipient names only (see participantsFor) — the comms mapping
            // turns this into participants_metadata.to for server-side
            // people-linking. Guild channels and unresolvable ids get none.
            ...(participants.length ? { To: participants } : {}),
            // The package only contains the owner's own messages, so From is
            // always the Account/user.json owner → participants_metadata.from.
            ...(ctx.selfName ? { From: ctx.selfName } : {}),
            Direction: 'outbound',
            Attachments: attachments || undefined,
            Source: 'Discord',
            Text: contents || undefined,
          },
        },
      });
    }
  }
}

registerDataSource({
  name: 'discord',
  title: 'Discord',
  icon: '',
  description:
    'Messages from a Discord "Request all of my data" package (per-channel messages.csv or messages.json).',
  newFileImporter: () => new DiscordFileImporter(),
});
