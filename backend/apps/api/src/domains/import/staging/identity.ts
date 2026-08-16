/**
 * Identity and content hashing for staged rows.
 *
 * Ported from CI-Import-Tools' `persistence.ts`, unchanged in behaviour and
 * separated out because all of it is pure: these functions decide what collapses
 * into what, which is the part of staging worth testing directly rather than
 * through a database.
 */
import { createHash } from 'node:crypto';

import type { Entity, Item, Metadata } from '../datasources/timeline';

const PHONE_ATTR_NAMES = new Set(['phone', 'tel', 'mobile', 'cell', 'sms']);
const EMAIL_ATTR_NAMES = new Set(['email', 'mail', 'e-mail']);

function looksLikeHandle(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed.includes('@')) {
    return true;
  }

  return trimmed.replace(/\D/g, '').length >= 7;
}

/**
 * Normalize a handle to a comparable key: lower-cased email, or the last ten
 * digits of a phone number. Returns '' for anything that is neither an email nor
 * a long-enough phone (a bare name).
 *
 * The last-ten-digits rule is what makes `+1 (555) 010-9999`, `555-010-9999` and
 * `15550109999` one person rather than three.
 */
export function normalizeHandle(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }

  const digits = trimmed.replace(/\D/g, '');

  return digits.length >= 7 ? digits.slice(-10) : '';
}

/**
 * The normalized identity handles an entity carries — drawn from exactly the
 * attributes {@link hasContactIdentity} treats as a contact signal. Kept in
 * lockstep with it so every entity that resolves to 'contact' via an identity
 * also produces a key.
 */
function identityHandles(entity: Entity): string[] {
  const out: string[] = [];

  for (const attribute of entity.attributes ?? []) {
    const name = (attribute?.name ?? '').toLowerCase();
    const named =
      PHONE_ATTR_NAMES.has(name) ||
      EMAIL_ATTR_NAMES.has(name) ||
      name.includes('phone') ||
      name.includes('email') ||
      name.includes('tel');

    if ((named || attribute?.identity) && looksLikeHandle(attribute.value)) {
      const handle = normalizeHandle(attribute.value);

      if (handle) {
        out.push(handle);
      }
    }
  }

  return out;
}

/**
 * A stable identity key for an entity: its lexicographically-smallest normalized
 * handle, or null when it carries none.
 *
 * Sorting makes the key independent of attribute order, so one real person
 * always keys the same way regardless of which message field (from/to/cc) or
 * which source surfaced them. This — not the mutable display name — is what
 * contacts dedup on.
 */
export function entityIdentityKey(entity: Entity): string | null {
  const handles = identityHandles(entity);

  if (!handles.length) {
    return null;
  }

  handles.sort();

  return handles[0];
}

/**
 * True when an entity carries a phone/email identity — i.e. it is really a
 * person even when the datasource forgot to set `type`.
 */
export function hasContactIdentity(entity: Entity): boolean {
  for (const attribute of entity.attributes ?? []) {
    const name = (attribute?.name ?? '').toLowerCase();

    if (
      PHONE_ATTR_NAMES.has(name) ||
      EMAIL_ATTR_NAMES.has(name) ||
      name.includes('phone') ||
      name.includes('email') ||
      name.includes('tel')
    ) {
      if (looksLikeHandle(attribute.value)) {
        return true;
      }
    }

    // Some sources tag an attribute as an identity without a recognisable name
    // (apple_contacts emits `{ name: '', value: '+1…', identity: true }`).
    if (attribute?.identity && looksLikeHandle(attribute.value)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve the staged `type` for an entity.
 *
 * Datasources that only know they captured a person's handle (gmail, telegram,
 * vcard, …) omit `type`; those default to 'contact' so they do not land as null
 * rows the push then mis-maps. Entities with no contact identity keep their
 * (possibly null) type untouched.
 */
export function resolveEntityType(entity: Entity): string | null {
  if (entity.type && entity.type.trim()) {
    return entity.type;
  }

  if (hasContactIdentity(entity)) {
    return 'contact';
  }

  return entity.type ?? null;
}

function dateToIso(value: Date | undefined): string | null {
  if (!value) {
    return null;
  }

  const time = value.getTime();

  return Number.isFinite(time) ? value.toISOString() : null;
}

/**
 * Stable hash for an item: an explicit parser id when there is one, otherwise a
 * sha1 over fields that describe the CONTENT.
 *
 * `intermediateLocation` is INTENTIONALLY EXCLUDED. Google Photos Takeout
 * replicates the same photo into every album folder it belongs to; with the file
 * path in the hash, `IMAG0262.jpg` under `European Vacation/` and the identical
 * file under `Photos from 2012/` hash differently and stage as two items — and
 * then reach ci.* as two events. Hashing only content-derived fields collapses
 * them on `staged_items_run_source_hash_uniq`, which is the whole reason that
 * index exists.
 */
export function hashItem(item: Item, dataSource: string): string {
  if (item.id) {
    return item.id;
  }

  const hash = createHash('sha1');

  hash.update(dataSource);
  hash.update('\0');
  hash.update(item.classification ?? '');
  hash.update('\0');
  hash.update(item.content?.filename ?? '');
  hash.update('\0');
  hash.update(dateToIso(item.timestamp) ?? '');
  hash.update('\0');

  if (item.location?.latitude != null && item.location?.longitude != null) {
    hash.update(`${item.location.latitude},${item.location.longitude}`);
  }

  return hash.digest('hex');
}

/**
 * Stable key for an entity for WITHIN-RUN dedup.
 *
 * Contacts key on their identity handle, so display-name drift inside one run —
 * "Alice", "Alice Smith" and the bare address for one real person — collapses to
 * a single row. Entities without a handle (email threads, places) fall back to
 * the RESOLVED type + name + attributes tuple, so a type-less contact and a
 * freshly-defaulted 'contact' still collapse.
 */
export function entityKey(entity: Entity): string {
  const identity = entityIdentityKey(entity);

  if (identity) {
    return `id:${identity}`;
  }

  return [resolveEntityType(entity) ?? '', entity.name ?? '', JSON.stringify(entity.attributes ?? [])].join(
    '|',
  );
}

// ---------------------------------------------------------------------------
// Accumulating metadata
// ---------------------------------------------------------------------------

function accumulatedValues(value: unknown): unknown[] {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  const out: unknown[] = [];

  for (const entry of Array.isArray(value) ? value : [value]) {
    if (entry === undefined || entry === null || entry === '') {
      continue;
    }

    if (entry instanceof Date) {
      out.push(entry.toISOString());
    } else if (typeof entry === 'object') {
      out.push(entry);
    } else {
      out.push(String(entry));
    }
  }

  return out;
}

/**
 * An entry's identity for the append-only-if-new check. Objects compare by
 * CONTENT with keys in sorted order, so re-importing the same record — where the
 * source may well build the object's keys in a different order — appends
 * nothing. Scalars compare as their string form, which is how they are stored.
 */
function accumulationKey(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value, (_key, entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const sorted: Record<string, unknown> = {};

        for (const key of Object.keys(entry as Record<string, unknown>).sort()) {
          sorted[key] = (entry as Record<string, unknown>)[key];
        }

        return sorted;
      }

      return entry;
    });
  }

  return String(value);
}

/**
 * Grow stored metadata with whatever this sighting adds, for the keys the entity
 * declared as accumulating.
 *
 * Values are appended only when new, so the same dish re-imported at the same
 * price is a no-op and the list stays a set in first-seen order. Only the
 * declared keys are touched: a re-import must not let a drifting display name or
 * a source's second-best guess overwrite what is already stored.
 *
 * Returns null when nothing grew, which is the signal not to write — and not to
 * set `graph_dirty`, which exists to make the push revisit a row that changed
 * after it was already sent.
 */
export function mergeAccumulatedMetadata(
  stored: Record<string, unknown>,
  entity: Entity,
): Record<string, unknown> | null {
  if (!entity.accumulate?.length || !entity.metadata) {
    return null;
  }

  const next = { ...stored };
  let grew = false;

  for (const key of entity.accumulate) {
    const incoming = accumulatedValues((entity.metadata as Metadata)[key]);

    if (!incoming.length) {
      continue;
    }

    const merged = accumulatedValues(next[key]);
    const seen = new Set(merged.map(accumulationKey));
    let added = false;

    for (const value of incoming) {
      const key_ = accumulationKey(value);

      if (seen.has(key_)) {
        continue;
      }

      seen.add(key_);
      merged.push(value);
      added = true;
    }

    if (!added) {
      continue;
    }

    next[key] = merged;
    grew = true;
  }

  return grew ? next : null;
}
