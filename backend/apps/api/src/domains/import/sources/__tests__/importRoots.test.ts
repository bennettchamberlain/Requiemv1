import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import config from '@ci/configuration';

import {
  PathOutsideImportRootsError,
  resolveWithinImportRoots,
  resolveWithinRoots,
} from '../importRoots';

/**
 * The guard on the path-based import tools.
 *
 * Upstream never needed one: the importer ran on the user's own machine as the
 * user. Here it is an API on an appliance, so an unconstrained absolute path is
 * a filesystem read primitive — a caller could enumerate `/etc`, or ingest it.
 *
 * Every case below is a way past a naive check, and each one has to fail closed.
 */

const roots = config.import.roots as string[];

async function withRoots<T>(next: string[], run: () => Promise<T>): Promise<T> {
  const previous = [...roots];

  roots.length = 0;
  roots.push(...next);

  try {
    return await run();
  } finally {
    roots.length = 0;
    roots.push(...previous);
  }
}


describe('resolveWithinImportRoots', () => {
  it('refuses everything when no roots are configured', async () => {
    // The default. Path imports stay off until an operator opts in, rather than
    // being on and hoping the check is right.
    await withRoots([], async () => {
      await expect(resolveWithinImportRoots('/etc/passwd')).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });

  it('allows a file inside a configured root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));
    const file = path.join(root, 'export.zip');

    await writeFile(file, 'bytes');

    await withRoots([root], async () => {
      expect(await resolveWithinImportRoots(file)).toContain('export.zip');
    });
  });

  it('refuses a traversal out of the root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));

    await withRoots([root], async () => {
      await expect(
        resolveWithinImportRoots(path.join(root, '..', '..', 'etc', 'passwd')),
      ).rejects.toBeInstanceOf(PathOutsideImportRootsError);
    });
  });

  it('refuses a sibling whose name merely starts with the root', async () => {
    // `/srv/exports-secret` must not pass because `/srv/exports` is a string
    // prefix of it. This is why containment compares path segments.
    const parent = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));
    const root = path.join(parent, 'exports');
    const sibling = path.join(parent, 'exports-secret');

    await mkdir(root);
    await mkdir(sibling);
    await writeFile(path.join(sibling, 'secret.zip'), 'bytes');

    await withRoots([root], async () => {
      await expect(resolveWithinImportRoots(path.join(sibling, 'secret.zip'))).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });

  it('refuses a symlink inside the root that points outside it', async () => {
    // The bypass a naive check misses: the literal path is contained, and only
    // following the link reveals where it actually leads. Hence realpath BEFORE
    // the containment test.
    const parent = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));
    const root = path.join(parent, 'exports');
    const outside = path.join(parent, 'elsewhere');

    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.zip'), 'bytes');
    await symlink(path.join(outside, 'secret.zip'), path.join(root, 'link.zip'));

    await withRoots([root], async () => {
      await expect(resolveWithinImportRoots(path.join(root, 'link.zip'))).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });

  it('reports a path that does not exist as out of bounds, not as missing', async () => {
    // "Does this file exist?" is information about a filesystem the caller has
    // no business reading, so absence and refusal answer identically.
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));

    await withRoots([root], async () => {
      await expect(resolveWithinImportRoots(path.join(root, 'nope.zip'))).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });


  it('still contains paths when a configured root does not exist', async () => {
    // An unmounted /repo must contribute nothing — not break resolution for
    // the roots that do exist, and not let anything through.
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));
    const file = path.join(root, 'export.zip');

    await writeFile(file, 'bytes');

    await withRoots(['/does/not/exist', root], async () => {
      expect(await resolveWithinImportRoots(file)).toContain('export.zip');
      await expect(resolveWithinImportRoots('/etc/passwd')).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });
});


describe('resolveWithinRoots', () => {
  it('refuses everything over an empty root set', async () => {
    await expect(resolveWithinRoots('/etc/passwd', [])).rejects.toBeInstanceOf(
      PathOutsideImportRootsError,
    );
  });
});
