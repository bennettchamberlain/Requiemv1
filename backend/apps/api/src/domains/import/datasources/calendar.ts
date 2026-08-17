/* Calendar (.ics) datasource (basic TypeScript port) */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

interface CalendarOptions {
  ownerEntityId?: number;
}

/** One parsed VEVENT, with the same stable id as the importer would assign. */
export interface ParsedIcsEvent {
  /** items.id — UID when present, otherwise `ics:<basename>:<sig>`. */
  id: string;
  summary: string;
  description: string;
  location?: string;
  dtStart?: Date;
  dtEnd?: Date;
  /** `DTSTART;VALUE=DATE` (or a bare `YYYYMMDD` value). */
  isAllDay: boolean;
  /** `RRULE` present and non-empty (the VEVENT is a series master). */
  isRecurring: boolean;
  /**
   * MIME Content-IDs of inline images referenced from the description as
   * `[cid:...]` (Exchange/Outlook exports). The .ics carries no attachment
   * bytes, so these are dangling pointers — recorded here (and stripped from
   * `description`) as the only surviving evidence the event had inline media.
   */
  inlineCids?: string[];
}

/**
 * Unescape an RFC 5545 §3.3.11 TEXT value (also used, near-identically, by
 * RFC 6350 §3.4 for vCard TEXT properties — see vcard.ts's re-export).
 *
 * Both specs define the same backslash escapes for a TEXT-valued property:
 *   \\  -> \        \;  -> ;        \,  -> ,        \n or \N -> newline
 * Real Apple Calendar/Contacts exports rely on this: any LOCATION/SUMMARY/
 * DESCRIPTION (or vCard NOTE) containing a literal `,` or `;` — e.g. a
 * street address "Foo Ave\, Springfield\, IL" — carries it escaped, and
 * until this was applied at parse time the raw `\,`/`\;`/`\n` sequences were
 * stored verbatim in items.metadata instead of being decoded to the real
 * punctuation/newline.
 *
 * A single left-to-right, non-overlapping regex pass naturally handles the
 * tricky case of an escaped backslash followed by a literal character (e.g.
 * `\\n` — an escaped backslash then a bare "n" — correctly stays "\" + "n"
 * rather than becoming a newline, because matching `\\` consumes both
 * characters before the scan reaches the "n"). An unrecognized escape (a
 * backslash followed by some other character) is treated leniently: the
 * backslash is dropped and the character kept as-is.
 */
export function unescapeIcsText(value: string): string {
  return value.replace(/\\(.)/g, (_, ch: string) => {
    switch (ch) {
      case 'n':
      case 'N':
        return '\n';
      case '\\':
      case ';':
      case ',':
        return ch;
      default:
        return ch;
    }
  });
}

/**
 * Parse one .ics file's VEVENT blocks. Shared between the live importer
 * (processICS) and the backfill (backfillCalendarMetadata), so an item id
 * produced by either path matches the row in items.
 */
export function parseIcsEvents(raw: string, fpath: string): ParsedIcsEvent[] {
  const unfolded = raw.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split(/BEGIN:VEVENT/).slice(1);
  const out: ParsedIcsEvent[] = [];
  for (const blockRaw of blocks) {
    const block = blockRaw.split(/END:VEVENT/)[0];
    const lines = block.split(/\r?\n/);
    const map: Record<string, string> = {};
    // Property params (the `;KEY=VAL;…` segment between name and `:`). Kept so
    // we can detect DTSTART's `VALUE=DATE` (all-day) — the value-only `map`
    // can't distinguish midnight-UTC from a date-only event after parsing.
    const paramsMap: Record<string, string> = {};
    for (const ln of lines) {
      const m = ln.match(/^([^:;]+)(;[^:]*)?:(.*)$/);
      if (!m) {
        continue;
      }

      const name = m[1].toUpperCase();
      map[name] = m[3];
      if (m[2]) {
        paramsMap[name] = m[2].slice(1);
      } // drop leading `;`
    }

    const uid = map['UID'];
    // Keep the raw (still RFC 5545 §3.3.11-escaped) values around for the id
    // `sig` below — the hash must stay byte-for-byte what it was before this
    // unescaping was added, or every UID-less event's id would change and
    // `INSERT OR IGNORE`/backfill idempotency would treat re-imports as new
    // rows. The *stored* summary/description/location are unescaped so
    // consumers (CLI, exports, CI-Server) see real punctuation, not `\,`/`\;`.
    const rawSummary = map['SUMMARY'] || '';
    const rawDescription = map['DESCRIPTION'] || '';
    const inlineCids = [...rawDescription.matchAll(/\[cid:([^\]\s]+)\]/gi)].map((m) => m[1]);
    const descriptionNoCid = inlineCids.length
      ? rawDescription.replace(/\s*\[cid:[^\]\s]+\]/gi, '').trim()
      : rawDescription;
    const rawLocation = map['LOCATION'];
    const summary = unescapeIcsText(rawSummary);
    const description = unescapeIcsText(descriptionNoCid);
    const location = rawLocation !== undefined ? unescapeIcsText(rawLocation) : undefined;
    const dtStart = parseICSDate(map['DTSTART']);
    const dtEnd = parseICSDate(map['DTEND']);
    // VALUE=DATE on DTSTART is the iCal signal for an all-day event (vs the
    // DATE-TIME default). Numeric YYYYMMDD without the param is also accepted
    // since real calendars sometimes omit it.
    const isAllDay =
      /(?:^|;)VALUE=DATE(?:;|$)/i.test(paramsMap['DTSTART'] || '') ||
      /^\d{8}$/.test((map['DTSTART'] || '').trim());
    // RRULE presence => recurring event. (We don't expand instances here; the
    // canonical row represents the series master, same as before.)
    const isRecurring = !!(map['RRULE'] && map['RRULE'].trim());
    // sig hashes the RAW (still-escaped) summary/location/description (cid
    // markers included) so ids of rows imported before the cid extraction —
    // and before TEXT-unescaping — existed stay stable across re-imports.
    const sig = crypto
      .createHash('sha1')
      .update(
        [map['DTSTART'] || '', map['DTEND'] || '', rawSummary, rawLocation || '', rawDescription].join('\0'),
      )
      .digest('hex');
    const id = uid && uid.trim() ? uid : `ics:${path.basename(fpath)}:${sig}`;
    out.push({
      id,
      summary,
      description,
      location,
      dtStart,
      dtEnd,
      isAllDay,
      isRecurring,
      ...(inlineCids.length ? { inlineCids } : {}),
    });
  }

  return out;
}

export class CalendarFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const full = entry.fullPath || entry.fsRoot || entry.filename;
    if (!full) {
      return { confidence: 0 };
    }

    if (fs.existsSync(full) && fs.statSync(full).isFile() && path.extname(full).toLowerCase() === '.ics') {
      return { confidence: 1.0 };
    }

    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      return { confidence: 0, dir_threshold: 0.9 };
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const start = entry.fullPath || entry.fsRoot || entry.filename;
    if (!start) {
      return;
    }

    const stat = fs.statSync(start);
    if (stat.isDirectory()) {
      for await (const f of this.walkDir(start)) {
        if (f.toLowerCase().endsWith('.ics')) {
          await this.processICS(f, params);
        }
      }
    } else if (start.toLowerCase().endsWith('.ics')) {
      await this.processICS(start, params);
    }
  }

  private async *walkDir(root: string): AsyncGenerator<string> {
    const ents = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of ents) {
      const full = path.join(root, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) {
          continue;
        }

        yield* this.walkDir(full);
      } else if (e.isFile()) {
        yield full;
      }
    }
  }

  private async processICS(fpath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', 'read ics failed', { file: path.basename(fpath), error: (e as Error).message });

      return;
    }

    for (const ev of parseIcsEvents(raw, fpath)) {
      if (!timeframeContains(params.timeframe, ev.dtStart)) {
        continue;
      }

      const content = [ev.summary, ev.description].filter(Boolean).join('\n');
      const item = {
        id: ev.id,
        classification: 'event',
        timestamp: ev.dtStart,
        timespanEnd: ev.dtEnd,
        intermediateLocation: fpath,
        content: {
          filename: path.basename(fpath),
          mediaType: 'text/plain',
          data: async () => Buffer.from(content),
        },
        metadata: {
          Source: 'ICS',
          Summary: ev.summary || undefined,
          Description: ev.description || undefined,
          Location: ev.location,
          isAllDay: ev.isAllDay,
          isRecurring: ev.isRecurring,
          // Inline images the export dropped (see ParsedIcsEvent.inlineCids).
          InlineAttachmentCids: ev.inlineCids?.join(', '),
        },
      };
      params.pipeline.push({ item });
    }
  }
}

// NOT PORTED, AND NOT COMING BACK: `backfillCalendarMetadata` and its
// `CalendarBackfillResult` lived here — a ~115-line repair pass that re-read
// each calendar item out of the standalone importer's SQLite `items` table and
// rewrote its stringified metadata in place.
//
// The earlier note here said it would return with the Postgres staging layer.
// That was written before staging was settled as RUN-SCOPED, and the two do not
// fit together: it repaired a cohort of rows written by an OLDER importer, and
// `ci_import.staged_*` is deleted with its run, so there is never a stale cohort
// there to repair. The durable side (`ci.*`) has never held calendar rows from
// an older parser either — rows arrive through the push carrying whatever the
// current parser produced. Its only caller was the standalone CLI, which is
// also not being ported.
//
// Its parser-side tests ARE restored, in `__tests__/calendar.test.ts`; only the
// backfill describe block stayed behind.

function parseICSDate(val?: string): Date | undefined {
  if (!val) {
    return undefined;
  }

  const v = val.trim();
  // All-day DATE: YYYYMMDD
  if (/^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4);
    const m = +v.slice(4, 6) - 1;
    const d = +v.slice(6, 8);

    return new Date(Date.UTC(y, m, d));
  }

  // UTC date-time: YYYYMMDDTHHMMSSZ
  if (/^\d{8}T\d{6}Z$/.test(v)) {
    const y = +v.slice(0, 4);
    const m = +v.slice(4, 6) - 1;
    const d = +v.slice(6, 8);
    const hh = +v.slice(9, 11);
    const mm = +v.slice(11, 13);
    const ss = +v.slice(13, 15);

    return new Date(Date.UTC(y, m, d, hh, mm, ss));
  }

  // Local/"floating" date-time: YYYYMMDDTHHMMSS with no zone. The line parser
  // strips the `;TZID=...` param before this point, so the original zone is no
  // longer available — treat the wall-clock as local time. This is the common
  // shape (e.g. `DTSTART;TZID=America/Grand_Turk:20091130T140000`) the old
  // two-pattern parser failed to match, leaving the event with no timestamp and
  // falling back to ingest-time `now` — which collapsed every such event onto a
  // single instant and broke the timeline ordering.
  if (/^\d{8}T\d{6}$/.test(v)) {
    const y = +v.slice(0, 4);
    const m = +v.slice(4, 6) - 1;
    const d = +v.slice(6, 8);
    const hh = +v.slice(9, 11);
    const mm = +v.slice(11, 13);
    const ss = +v.slice(13, 15);

    return new Date(y, m, d, hh, mm, ss);
  }

  // Anything else already in a Date-parseable form (e.g. RFC 3339 with offset).
  const d = new Date(v);

  return isNaN(d.getTime()) ? undefined : d;
}

registerDataSource({
  name: 'calendar',
  title: 'Calendar',
  icon: 'calendar.svg',
  description: '.ics calendar files (naive parser)',
  newOptions: () => ({ ownerEntityId: undefined }) as CalendarOptions,
  newFileImporter: () => new CalendarFileImporter(),
});
