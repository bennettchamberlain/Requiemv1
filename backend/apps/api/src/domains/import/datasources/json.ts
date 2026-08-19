/* Shared helpers for walking untyped vendor JSON.
 *
 * Export archives are third-party JSON with no schema we control: keys appear
 * and vanish between vendor releases, and a missing branch must degrade to
 * "skip this record", never throw. The importers used to type these blobs as
 * `Record<string, any>`, which made every deep access compile but silenced the
 * type system exactly where the data is least trustworthy.
 *
 * These helpers keep the values `unknown` and narrow explicitly at each step,
 * so a shape change surfaces as an undefined branch the caller must handle
 * rather than a runtime TypeError deep inside a parse.
 */

/** A JSON object, once narrowed. */
export type JsonRecord = Record<string, unknown>;

/** Narrow to a plain (non-array) object, or undefined when it isn't one. */
export function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

/** Narrow to an array, or undefined when it isn't one. */
export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** Narrow to a string, or undefined. Numbers are NOT coerced. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Narrow to a finite number. Numeric strings ARE accepted — vendors are
 *  inconsistent about quoting ids, counts and timestamps. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);

    return Number.isFinite(n) ? n : undefined;
  }

  return undefined;
}

/**
 * Walk a chain of object keys through untyped JSON, returning `undefined` as
 * soon as any level is missing or not an object. Replaces the
 * `obj?.['A']?.['B']?.['C']` chains that only compiled because the blob was
 * typed `any`.
 */
export function dig(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record) {
      return undefined;
    }

    current = record[key];
  }

  return current;
}
