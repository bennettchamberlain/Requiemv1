import fs from 'node:fs';

/**
 * Cheap content peeks for recognizers.
 *
 * The lesson, learned three times in one Takeout session: a recognizer that
 * claims a file by NAME alone will eventually claim someone else's file.
 * Google exports a YouTube comment history named `comments.csv` (matched the
 * Reddit signature), a readme.md (matched Notion), and an address-book CSV
 * (matched the generic contact list). Every claim should look at the first
 * bytes: for CSVs the header row IS a schema, and requiring the columns the
 * parser actually reads costs one 4 KB read and removes the whole failure
 * class — a file that passes would have parsed anyway.
 *
 * All helpers fail CLOSED (unreadable → no match): recognition runs over
 * user-supplied trees where anything can be a broken symlink or a directory
 * wearing a `.csv` name.
 */

/** First `bytes` of the file as utf8, or null when unreadable. */
export function readHead(fpath: string, bytes = 4096): string | null {
  let fd: number | undefined;

  try {
    fd = fs.openSync(fpath, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);

    return buf.toString('utf8', 0, n);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Does the CSV's header row carry every required column?
 *
 * Case-insensitive; tolerates a UTF-8 BOM, quoted headers, and \r\n. Column
 * matching is exact per cell (not substring), so `id` does not match
 * `Comment ID`. Callers pass the columns their PARSER reads — the check then
 * has no vocabulary of its own to drift.
 */
export function csvHeaderHas(fpath: string, required: readonly string[]): boolean {
  const head = readHead(fpath);

  if (head == null) {
    return false;
  }

  const firstLine = head.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const cells = new Set(
    firstLine.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '').trim().toLowerCase()),
  );

  return required.every((column) => cells.has(column.toLowerCase()));
}

/** Does the file's head match the pattern? For XML/JSON roots and the like. */
export function headMatches(fpath: string, pattern: RegExp): boolean {
  const head = readHead(fpath);

  return head != null && pattern.test(head);
}
