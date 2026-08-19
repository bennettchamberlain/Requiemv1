import { lstatSync } from 'node:fs';
import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { freeBytesAt } from '../archive/unpack';

import { resolveWithinStaging } from './importRoots';

/**
 * How the unit ended up in scratch. `rename` is the designed case (inbox and
 * scratch share a filesystem); `copy` is the EXDEV fallback; `recovered` means
 * a previous attempt already got it there and this call only had to notice.
 */
export type AcquireMethod = 'rename' | 'copy' | 'recovered';

export interface AcquireLocalUnitInput {
  /** Realpath of the source, recorded inside a staging area at claim time. */
  sourcePath: string;
  /** The run's scratch directory. */
  scratchDir: string;
  /** Advisory size of the unit, for the copy-fallback disk preflight. */
  sizeBytes: number | null;
  log: (message: string) => void;
  /** Test seam: overrides the filesystem rename to simulate EXDEV. */
  renameImpl?: typeof rename;
}

export class InsufficientScratchSpaceError extends Error {
  constructor(needed: number, free: number) {
    super(
      `Not enough disk space to copy this unit into the import's working area: ` +
        `about ${Math.ceil(needed / 1e9)}GB needed, ${Math.floor(free / 1e9)}GB free. ` +
        `Free space and retry the stage.`,
    );
    this.name = 'InsufficientScratchSpaceError';
  }
}

/**
 * Move a staged source (an upload's staged copy, or an inbox unit) into the
 * run's scratch — the acquisition half of every import, and the ONLY code
 * that mutates the staging areas.
 *
 * The move is transactional per unit, built from two renames through a
 * deterministic temp name:
 *
 *   1. `rename(source, tmp)` — atomic on one filesystem; on EXDEV, a copy
 *      into `tmp` followed by deleting `source` ONLY after the copy completed.
 *   2. `rename(tmp, dest)` — same-filesystem, atomic finalize.
 *
 * Both names derive from durable state (the claim's `source_path` and the
 * run's scratch dir), so a retry after any crash can look at the filesystem
 * and finish the story:
 *
 *   - `dest` exists      → a previous attempt finalized; nothing to do.
 *   - `tmp`, no `source` → the first rename landed and the finalize did not;
 *                          finish the second rename.
 *   - `tmp` AND `source` → a copy fallback died mid-write; the source is
 *                          intact, so scrap `tmp` and start over.
 *
 * A NEW same-named unit dropped into the inbox between a crash and the retry
 * is deliberately left alone when `dest` already exists: this run's bytes are
 * the ones that reached scratch, and the newcomer is a different unit for a
 * later batch. Do not "fix" the dest-exists branch into a re-move — that
 * would import someone's fresh copy under a finished claim.
 *
 * Defense in depth: the source is re-resolved against the inbox immediately
 * before the mutation, even though the claim already validated it — a
 * `staged_sources` row edited to point elsewhere must be refused HERE, at the
 * site that moves and deletes, not only at enqueue.
 */
export async function acquireLocalUnit(
  input: AcquireLocalUnitInput,
): Promise<{ destPath: string; method: AcquireMethod }> {
  const doRename = input.renameImpl ?? rename;
  const name = path.basename(input.sourcePath);
  const destPath = path.join(input.scratchDir, name);
  const tmpPath = path.join(input.scratchDir, `.acquiring-${name}`);

  await mkdir(input.scratchDir, { recursive: true });

  if (await exists(destPath)) {
    input.log(`acquire: ${name} already in scratch from a previous attempt`);

    return { destPath, method: 'recovered' };
  }

  if (await exists(tmpPath)) {
    if (await exists(input.sourcePath)) {
      // A copy fallback died mid-write. The source is whole, so the partial
      // copy is garbage.
      input.log(`acquire: scrapping partial copy of ${name} and starting over`);
      await rm(tmpPath, { recursive: true, force: true });
    } else {
      // The first rename landed and the finalize did not.
      input.log(`acquire: finishing interrupted move of ${name}`);
      await doRename(tmpPath, destPath);

      return { destPath, method: 'recovered' };
    }
  }

  // Refuses anything outside the staging areas the importer owns (inbox and
  // uploads) — including a row whose path was tampered with after the claim.
  // Throws PathOutsideImportRootsError, which fails the stage without
  // touching the filesystem.
  const resolved = await resolveWithinStaging(input.sourcePath);

  try {
    await doRename(resolved, tmpPath);
    await doRename(tmpPath, destPath);

    return { destPath, method: 'rename' };
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'EXDEV') {
      throw err;
    }
  }

  // The inbox and scratch are on different filesystems (an operator split the
  // mounts). Copy, then delete the source ONLY after the copy completed — the
  // ordering is the entire guarantee here.
  const needed = Math.ceil((input.sizeBytes ?? (await stat(resolved)).size) * 1.1);
  const free = freeBytesAt(input.scratchDir);

  if (free != null && free < needed) {
    throw new InsufficientScratchSpaceError(needed, free);
  }

  input.log(`acquire: inbox and scratch are on different filesystems; copying ${name}`);

  // Symlinks are skipped rather than followed: the scan never offers them,
  // and a link inside a unit must not smuggle outside bytes into scratch.
  await cp(resolved, tmpPath, {
    recursive: true,
    dereference: false,
    filter: (src) => !isSymlink(src),
  });
  await rm(resolved, { recursive: true, force: true });
  await doRename(tmpPath, destPath);

  return { destPath, method: 'copy' };
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);

    return true;
  } catch {
    return false;
  }
}

function isSymlink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}
