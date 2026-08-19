/* Shared parsing for AI-assistant "memory" exports (ChatGPT, Claude, Gemini).
   Cross-vendor memory portability (Gemini/Claude import, Mar 2026) made these
   files a normal part of a data export, but no vendor publishes a schema and
   the shapes drift between releases: the list may be a bare array or wrapped
   in an object key, entries may be plain strings or objects, entry text may
   live under `content`/`text`/`memory`/`summary`/`value`, and timestamps come
   as epoch seconds, epoch millis, or ISO strings. This module normalizes all
   of that. Vendor RECOGNITION (whose file is this?) stays in each datasource —
   this module only answers "what memories does this JSON contain?" plus a few
   shape hints the datasources use to disambiguate a shared filename. */

export interface MemoryEntry {
  text: string;
  created?: Date;
  updated?: Date;
  category?: string;
  /** Vendor-stable id (`id`/`uuid`) when the entry carries one. */
  idHint?: string;
  /** Display title when the entry has a better one than its first text line
      (profile sections use their section heading). */
  title?: string;
}

/** Shape signals used to attribute a memory file to a vendor. ChatGPT exports
    stamp epoch-number timestamps (like conversations.json `create_time`);
    Claude exports stamp ISO strings and `uuid` fields (like chat_messages). */
export interface MemoryShapeHints {
  numericTimes: boolean;
  isoTimes: boolean;
  uuids: boolean;
}

const LIST_KEYS = [
  'memories',
  'memory',
  'saved_info',
  'savedInfo',
  'saved_information',
  'entries',
  'items',
  'records',
  'data',
];
const TEXT_KEYS = ['content', 'text', 'memory', 'summary', 'value', 'description'];
// Claude's post-Mar-2026 export ships the whole account memory profile as one
// markdown blob per entry under this key (sibling `account_uuid` identifies
// the account), organized by `**Section**` header lines.
const PROFILE_KEYS = ['conversations_memory'];
const CATEGORY_KEYS = ['category', 'topic', 'label'];
const CREATED_KEYS = [
  'created_at',
  'create_time',
  'createdAt',
  'created',
  'inserted_at',
  'timestamp',
  'time',
  'date',
];
const UPDATED_KEYS = ['updated_at', 'update_time', 'updatedAt', 'updated', 'modified_at', 'last_updated'];

/** Extract the entry list from a parsed memory file: the value itself when it
    is an array, else the first array found under a known wrapper key. */
export function unwrapMemoryList(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  const obj = parsed as Record<string, unknown>;
  for (const key of LIST_KEYS) {
    if (Array.isArray(obj[key])) {
      return obj[key] as unknown[];
    }
  }

  return undefined;
}

/** Epoch seconds, epoch millis, numeric strings, and ISO strings → Date. */
function toDate(v: unknown): Date | undefined {
  if (v == null) {
    return undefined;
  }

  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) {
    v = Number(v);
  }

  if (typeof v === 'number') {
    if (!isFinite(v) || v <= 0) {
      return undefined;
    }

    const d = new Date(v > 1e12 ? v : v * 1000);

    return isNaN(d.getTime()) ? undefined : d;
  }

  if (typeof v === 'string' && v) {
    const d = new Date(v);

    return isNaN(d.getTime()) ? undefined : d;
  }

  return undefined;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) {
      return v;
    }
  }

  return undefined;
}

function firstDate(obj: Record<string, unknown>, keys: string[]): Date | undefined {
  for (const key of keys) {
    const d = toDate(obj[key]);
    if (d) {
      return d;
    }
  }

  return undefined;
}

function normalizeEntry(raw: unknown): MemoryEntry | undefined {
  if (typeof raw === 'string') {
    return raw.trim() ? { text: raw.trim() } : undefined;
  }

  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const text = firstString(obj, TEXT_KEYS);
  if (!text) {
    return undefined;
  }

  const id = obj.id ?? obj.uuid;

  return {
    text: text.trim(),
    created: firstDate(obj, CREATED_KEYS),
    updated: firstDate(obj, UPDATED_KEYS),
    category: firstString(obj, CATEGORY_KEYS),
    idHint: typeof id === 'string' && id ? id : typeof id === 'number' ? String(id) : undefined,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Split an aggregate memory-profile blob into one entry per `**Section**`.
    idHint keys off the account uuid + section slug (not a content hash) so a
    re-import after the profile is edited supersedes the previous notes
    instead of accumulating stale snapshots. */
function profileEntries(obj: Record<string, unknown>): MemoryEntry[] | undefined {
  const blob = firstString(obj, PROFILE_KEYS);
  if (!blob) {
    return undefined;
  }

  const account = typeof obj.account_uuid === 'string' && obj.account_uuid ? obj.account_uuid : 'profile';
  const out: MemoryEntry[] = [];
  const usedSlugs = new Set<string>();
  let section: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    buf = [];
    if (!text) {
      return;
    }

    let slug = section ? slugify(section) : 'general';
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${section ? slugify(section) : 'general'}-${n++}`;
    }

    usedSlugs.add(slug);
    out.push({ text, category: section, title: section, idHint: `${account}:${slug}` });
  };

  for (const line of blob.split('\n')) {
    const m = /^\s*\*\*(.+?)\*\*\s*$/.exec(line);
    if (m) {
      flush();
      section = m[1].trim();
    } else {
      buf.push(line);
    }
  }

  flush();

  return out;
}

/** Every normalizable memory entry in a parsed memory file (empty when the
    value is not a memory list at all). */
export function parseMemoryEntries(parsed: unknown): MemoryEntry[] {
  const list = unwrapMemoryList(parsed);
  if (!list) {
    return [];
  }

  const out: MemoryEntry[] = [];
  for (const raw of list) {
    if (raw && typeof raw === 'object') {
      const profile = profileEntries(raw as Record<string, unknown>);
      if (profile) {
        out.push(...profile);
        continue;
      }
    }

    const entry = normalizeEntry(raw);
    if (entry) {
      out.push(entry);
    }
  }

  return out;
}

export function memoryShapeHints(parsed: unknown): MemoryShapeHints {
  const hints: MemoryShapeHints = { numericTimes: false, isoTimes: false, uuids: false };
  const list = unwrapMemoryList(parsed) ?? [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }

    const obj = raw as Record<string, unknown>;
    if (
      (typeof obj.uuid === 'string' && obj.uuid) ||
      (typeof obj.account_uuid === 'string' && obj.account_uuid)
    ) {
      hints.uuids = true;
    }

    for (const key of [...CREATED_KEYS, ...UPDATED_KEYS]) {
      const v = obj[key];
      if (typeof v === 'number') {
        hints.numericTimes = true;
      } else if (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v.trim()) && toDate(v)) {
        hints.isoTimes = true;
      }
    }
  }

  return hints;
}

/** Single-line preview of a memory used as the content row's title. */
export function memoryTitle(text: string, max = 80): string {
  const line = text.split('\n', 1)[0].trim();

  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}
