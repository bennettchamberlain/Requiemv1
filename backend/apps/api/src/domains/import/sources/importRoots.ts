import { realpath } from 'node:fs/promises';
import path from 'node:path';

import config from '@ci/configuration';

/**
 * Where a caller is allowed to point the path-based import tools.
 *
 * Upstream this question did not exist: the importer ran on the user's own
 * machine, under their own account, and "import this path" meant a path they
 * already had. Here it is an API on an appliance, reachable by any MCP client
 * holding a token — so an unconstrained absolute path is a filesystem read
 * primitive that would let a caller enumerate `/etc`, or ingest it.
 *
 * The roots are therefore explicit. Empty by default: nothing is importable by
 * path until an operator says which directory holds the exports, which is the
 * safe way round for a capability that only some deployments want. Uploading
 * through the API is unaffected and remains the ordinary path.
 */
export function configuredImportRoots(): string[] {
  return config.import.roots.filter((root) => root.trim().length > 0).map((root) => path.resolve(root));
}

/**
 * Where uploads are staged: `<uploadsDir>/<dropId>/<filename>`, registered in
 * `ci_import.staged_sources`. Importer-owned, unlike the roots, which hold
 * the user's own files — nothing lands here except through the API, and the
 * TTL purge sweeps it.
 */
export function uploadsRoot(): string {
  return path.resolve(config.import.uploadsDir);
}

/** Raised when a caller points at somewhere they may not read. */
export class PathOutsideImportRootsError extends Error {
  constructor(requested: string, roots: string[]) {
    super(
      roots.length === 0
        ? `Path imports are not enabled on this appliance. Set CI_IMPORT_ROOTS to the directories ` +
            `that hold exports, or upload the archive instead.`
        : `${requested} is outside the configured import roots (${roots.join(', ')}).`,
    );
    this.name = 'PathOutsideImportRootsError';
  }
}

/**
 * Resolve a caller-supplied path against an explicit root set, or refuse it.
 *
 * Resolution goes through `realpath` BEFORE the containment check, so a symlink
 * inside a root that points outside one is rejected on where it actually leads
 * rather than where it appears to sit. Checking the literal path first and
 * following the link afterwards is the ordering that produces a bypass.
 *
 * Containment compares path SEGMENTS, not string prefixes: `/srv/exports-secret`
 * must not pass because `/srv/exports` is a prefix of it.
 *
 * A root whose own `realpath` fails (an unmounted volume) contributes nothing
 * rather than failing every resolution — the other roots still work.
 */
export async function resolveWithinRoots(requested: string, roots: string[]): Promise<string> {
  if (roots.length === 0) {
    throw new PathOutsideImportRootsError(requested, roots);
  }

  let resolved: string;

  try {
    resolved = await realpath(path.resolve(requested));
  } catch {
    // A path that cannot be resolved is reported as out of bounds rather than
    // as missing: "does this file exist?" is itself information about a
    // filesystem the caller has no business reading.
    throw new PathOutsideImportRootsError(requested, roots);
  }

  const contained = await Promise.all(
    roots.map(async (root) => {
      let realRoot: string;

      try {
        realRoot = await realpath(root);
      } catch {
        return false;
      }

      const relative = path.relative(realRoot, resolved);

      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }),
  );

  if (!contained.some(Boolean)) {
    throw new PathOutsideImportRootsError(requested, roots);
  }

  return resolved;
}

/**
 * The read-side resolver the path tools use: the operator's roots. The uploads
 * directory is deliberately NOT included — staged uploads are per-user, and a
 * path tool must not become a way to read another user's staged archive.
 */
export async function resolveWithinImportRoots(requested: string): Promise<string> {
  return resolveWithinRoots(requested, configuredImportRoots());
}

/**
 * The mutation-site resolver: the staging areas the importer OWNS. Today that
 * is the uploads directory; `localAcquire` re-validates through this
 * immediately before moving or deleting, so a registry row edited to point
 * elsewhere is refused where the mutating happens, not only at enqueue.
 */
export async function resolveWithinStaging(requested: string): Promise<string> {
  return resolveWithinRoots(requested, [uploadsRoot()]);
}
