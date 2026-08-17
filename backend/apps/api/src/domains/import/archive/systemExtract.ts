import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Extracting a zip through whichever system extractor can actually read it.
 *
 * `unzip` is the primary and stays that way: it is what the appliance image
 * ships, it streams (so a 50GB Takeout split never has to fit in memory), it
 * reads ZIP64, and it is tolerant of the path-collision quirks in Drive exports
 * that abort stricter extractors.
 *
 * It is also, on macOS, unable to extract a large class of real exports. The
 * system `unzip` there is Info-ZIP 6.00 (2009) with no `-O`/charset flag, so an
 * entry whose name is not ASCII — `Voice/Calls/Mariana Acuña - Text - ….html`
 * in a Google Takeout, which is to say any export belonging to a person with
 * accented names in their contacts — fails to create the file and aborts the
 * whole archive with **exit 50**, whose documented meaning is "the disk is (or
 * was) full during extraction". The disk is not full. Nothing downstream can
 * tell those two apart, so the run surfaces a disk error for a filename problem
 * and a multi-gigabyte import dies at 0%.
 *
 * Linux Info-ZIP (Debian/Ubuntu) accepts `-O`/`-I` charset flags. Passing
 * UTF-8 there makes Takeout names land correctly instead of as CP437
 * mojibake (`ñ` → `├▒`). macOS Info-ZIP has no such flags, so we still fall
 * back to `ditto` whenever `unzip` fails: on macOS that turns the common
 * failure into a success, and on Linux `ditto` does not exist.
 *
 * Path containment is deliberately NOT this module's job — callers that need it
 * (see `extract.ts`) assert it against the archive's listed entry names before
 * extracting, which holds whichever extractor then runs.
 */

export interface SystemExtractResult {
  ok: boolean;
  /**
   * True when an extractor errored but still produced a tree. A real Google
   * Takeout can carry entries no extractor will take — a name used as both a
   * file and a directory (a Drive-export quirk), an unsupported compression
   * method — and failing the whole archive over them throws away everything
   * else. Callers import what arrived and report the shortfall.
   */
  partial?: boolean;
  /** Which extractor produced the tree. `null` when none could run. */
  tool: 'unzip' | 'ditto' | null;
  /** Human-readable cause, for the error a caller raises. Empty when ok. */
  detail: string;
}

let unzipProbe: boolean | undefined;

/** Whether the system `unzip` can be invoked at all. Cached; probes once. */
export function systemUnzipAvailable(): boolean {
  if (unzipProbe === undefined) {
    try {
      unzipProbe = spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;
    } catch {
      unzipProbe = false;
    }
  }

  return unzipProbe;
}

let unzipUtf8CharsetProbe: boolean | undefined;

/**
 * Whether this `unzip` accepts `-O`/`-I` charset flags (Debian/Ubuntu yes,
 * stock macOS Info-ZIP 6.00 no). Cached; probes once via `unzip -hh`.
 */
export function unzipSupportsUtf8Charset(): boolean {
  if (unzipUtf8CharsetProbe === undefined) {
    if (!systemUnzipAvailable()) {
      unzipUtf8CharsetProbe = false;
    } else {
      try {
        const help = spawnSync('unzip', ['-hh'], { encoding: 'utf8' });
        const text = `${help.stdout ?? ''}\n${help.stderr ?? ''}`;
        unzipUtf8CharsetProbe = /(?:^|\s)-O\s+CHARSET/i.test(text);
      } catch {
        unzipUtf8CharsetProbe = false;
      }
    }
  }

  return unzipUtf8CharsetProbe;
}

function unzipExtractArgs(archive: string, destDir: string): string[] {
  const args = ['-o', '-qq'];
  if (unzipSupportsUtf8Charset()) {
    // -O = DOS/Windows/OEM names (Takeout); -I = UNIX names. Both UTF-8 so
    // bit-11-clear archives keep the bytes Google actually wrote.
    args.push('-O', 'UTF-8', '-I', 'UTF-8');
  }

  args.push(archive, '-d', destDir);

  return args;
}

let dittoProbe: boolean | undefined;

/** Whether `ditto` can be invoked — true on macOS, false essentially everywhere else. */
export function dittoAvailable(): boolean {
  if (dittoProbe === undefined) {
    try {
      // `ditto` has no --version; it exits 1 on a bare invocation and 64 on a
      // usage error. Either proves the binary resolved, which is all we ask.
      dittoProbe = spawnSync('ditto', [], { stdio: 'ignore' }).error === undefined;
    } catch {
      dittoProbe = false;
    }
  }

  return dittoProbe;
}

/** True if SOME extractor is available, so a caller can fail early with a clear message. */
export function systemExtractAvailable(): boolean {
  return systemUnzipAvailable() || dittoAvailable();
}

/**
 * Extract `archive` into `destDir`, trying `unzip` then `ditto`.
 *
 * `-o` overwrites, so a resumed extraction — or a retry after a partial `unzip`
 * left files behind — completes rather than prompting; `-qq` is silent. `unzip`
 * exits 0 (ok) or 1 (ok, with warnings such as a skipped bad entry) and both
 * count as success. `ditto -x -k` unpacks a PKZip archive; it reports success
 * only on 0.
 *
 * When BOTH refuse, the destination is checked before giving up: an archive can
 * carry a few entries nothing will take while the rest extracted fine.
 */
/** Whether anything at all landed under `destDir`. */
function extractedAnything(destDir: string): boolean {
  const walk = (dir: string): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    return entries.some((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.isFile()));
  };

  return walk(destDir);
}

export function systemExtract(archive: string, destDir: string): SystemExtractResult {
  let detail = '';

  if (systemUnzipAvailable()) {
    const r = spawnSync('unzip', unzipExtractArgs(archive, destDir), { stdio: 'ignore' });

    if (r.status === 0 || r.status === 1) {
      return { ok: true, tool: 'unzip', detail: '' };
    }

    detail =
      r.status === 50
        ? `unzip exit 50 — reported as "disk full", which on macOS is usually a non-ASCII entry name it cannot write`
        : `unzip exit ${r.status}`;
  } else {
    detail = `system 'unzip' is unavailable`;
  }

  if (dittoAvailable()) {
    const d = spawnSync('ditto', ['-x', '-k', archive, destDir], { stdio: 'ignore' });

    if (d.status === 0) {
      return { ok: true, tool: 'ditto', detail: '' };
    }

    detail += `; ditto exit ${d.status}`;
  }

  // Both refused — but between them they may have written most of the archive.
  // Measured on a real 3.3GB Takeout: unzip exited 50 and ditto exited 1 on two
  // bad entries, having already extracted 2.8GB across 1,087 files. Discarding
  // that is a worse answer than importing it and saying what was missed.
  if (extractedAnything(destDir)) {
    return { ok: true, tool: null, partial: true, detail };
  }

  return { ok: false, tool: null, detail };
}
