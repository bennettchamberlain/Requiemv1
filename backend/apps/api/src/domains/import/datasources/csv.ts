/* Shared CSV parsing for datasource importers, built on csv-parse.
   Importers read whole files into memory, so the sync API is used throughout.
   Handles quoted fields, escaped quotes (""), embedded newlines, CRLF, and a
   UTF-8 BOM. Ragged rows are preserved (missing cells read as ''). */
import { parse } from 'csv-parse/sync';

export interface ParseCSVRowsOptions {
  /** Field delimiter. Default ','. */
  delimiter?: string;
}

export interface ParseCSVOptions extends ParseCSVRowsOptions {
  /** Trim whitespace from cell values (headers are always trimmed). Default true. */
  trimValues?: boolean;
  /** Omit empty cells from row objects instead of including ''. Default false. */
  omitEmpty?: boolean;
  /** Locate the header row when the file has preamble lines before it: the
      first row matching the predicate becomes the header and everything above
      it is discarded. Returns [] if no row matches. Default: the first row. */
  findHeader?: (row: string[]) => boolean;
}

/** Parse CSV text into raw rows (no header mapping). */
export function parseCSVRows(text: string, opts: ParseCSVRowsOptions = {}): string[][] {
  const parseOpts = {
    bom: true,
    delimiter: opts.delimiter ?? ',',
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  };
  try {
    return parse(text, parseOpts) as string[][];
  } catch (e) {
    // A file that ends inside an open quote (truncated download, binary
    // garbage). Close the quote and re-parse so the pending field is flushed —
    // importers must tolerate malformed input without throwing.
    if ((e as { code?: string }).code === 'CSV_QUOTE_NOT_CLOSED') {
      return parse(text + '"', parseOpts) as string[][];
    }

    throw e;
  }
}

/** Parse CSV text into header-keyed records — the common importer shape.
    Rows whose cells are all empty are dropped. */
export function parseCSV(text: string, opts: ParseCSVOptions = {}): Record<string, string>[] {
  const rows = parseCSVRows(text, opts);
  let headerIdx = 0;
  if (opts.findHeader) {
    headerIdx = rows.findIndex(opts.findHeader);
    if (headerIdx === -1) {
      return [];
    }
  }

  if (headerIdx >= rows.length) {
    return [];
  }

  const headers = rows[headerIdx].map((h) => h.trim());
  const trim = opts.trimValues !== false;

  return rows
    .slice(headerIdx + 1)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => {
      const o: Record<string, string> = {};
      headers.forEach((h, j) => {
        const v = trim ? (r[j] ?? '').trim() : (r[j] ?? '');
        if (!opts.omitEmpty || v) {
          o[h] = v;
        }
      });

      return o;
    });
}
