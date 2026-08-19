import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import config from '@ci/configuration';

import {
  PathOutsideImportRootsError,
  resolveWithinImportRoots,
  resolveWithinRoots,
  resolveWithinUserInbox,
  userInboxDir,
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

async function withInbox<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const previous = config.import.inboxDir;

  (config.import as { inboxDir: string }).inboxDir = dir;

  try {
    return await run();
  } finally {
    (config.import as { inboxDir: string }).inboxDir = previous;
  }
}

describe('resolveWithinImportRoots', () => {
  it('refuses everything when no roots are configured', async () => {
    // The default. Path imports stay off until an operator opts in, rather than
    // being on and hoping the check is right.
    await withRoots([], async () => {
      await expect(resolveWithinImportRoots('/etc/passwd', null)).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });

  it('allows a file inside a configured root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));
    const file = path.join(root, 'export.zip');

    await writeFile(file, 'bytes');

    await withRoots([root], async () => {
      expect(await resolveWithinImportRoots(file, null)).toContain('export.zip');
    });
  });

  it('refuses a traversal out of the root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));

    await withRoots([root], async () => {
      await expect(
        resolveWithinImportRoots(path.join(root, '..', '..', 'etc', 'passwd'), null),
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
      await expect(resolveWithinImportRoots(path.join(sibling, 'secret.zip'), null)).rejects.toBeInstanceOf(
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
      await expect(resolveWithinImportRoots(path.join(root, 'link.zip'), null)).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });

  it('reports a path that does not exist as out of bounds, not as missing', async () => {
    // "Does this file exist?" is information about a filesystem the caller has
    // no business reading, so absence and refusal answer identically.
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));

    await withRoots([root], async () => {
      await expect(resolveWithinImportRoots(path.join(root, 'nope.zip'), null)).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });

  it("allows the caller's own inbox subtree, even with no roots configured — and only theirs", async () => {
    // The same composition upstream made when it appended its data dir to
    // CI_IMPORT_ROOTS, narrowed per account: reading one's OWN inbox slice is
    // on by default regardless of the operator's roots; another account's
    // slice, the shared root, and an anonymous caller get nothing.
    const inbox = await mkdtemp(path.join(os.tmpdir(), 'ci-inbox-'));

    await mkdir(path.join(inbox, 'kyle_lifescope.io'));
    await mkdir(path.join(inbox, 'other_lifescope.io'));

    const mine = path.join(inbox, 'kyle_lifescope.io', 'export.zip');
    const theirs = path.join(inbox, 'other_lifescope.io', 'export.zip');
    const shared = path.join(inbox, 'export.zip');

    await writeFile(mine, 'bytes');
    await writeFile(theirs, 'bytes');
    await writeFile(shared, 'bytes');

    await withRoots([], () =>
      withInbox(inbox, async () => {
        expect(await resolveWithinImportRoots(mine, 'kyle@lifescope.io')).toContain('export.zip');

        for (const refused of [theirs, shared]) {
          await expect(resolveWithinImportRoots(refused, 'kyle@lifescope.io')).rejects.toBeInstanceOf(
            PathOutsideImportRootsError,
          );
        }

        await expect(resolveWithinImportRoots(mine, null)).rejects.toBeInstanceOf(
          PathOutsideImportRootsError,
        );
      }),
    );
  });

  it('still contains paths when a configured root does not exist', async () => {
    // An unmounted /repo must contribute nothing — not break resolution for
    // the roots that do exist, and not let anything through.
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));
    const file = path.join(root, 'export.zip');

    await writeFile(file, 'bytes');

    await withRoots(['/does/not/exist', root], async () => {
      expect(await resolveWithinImportRoots(file, null)).toContain('export.zip');
      await expect(resolveWithinImportRoots('/etc/passwd', null)).rejects.toBeInstanceOf(
        PathOutsideImportRootsError,
      );
    });
  });
});

describe('resolveWithinUserInbox', () => {
  it('derives the user folder from the email, lowercased and sanitized', async () => {
    const inbox = await mkdtemp(path.join(os.tmpdir(), 'ci-inbox-'));

    await withInbox(inbox, async () => {
      expect(userInboxDir('Kyle@Lifescope.IO')).toBe(path.join(inbox, 'kyle_lifescope.io'));
    });
  });

  it("allows the caller's subtree and refuses everything else", async () => {
    // The consume-side resolver: ONE user's slice, nothing else. A file under
    // CI_IMPORT_ROOTS is the user's own and must never reach the code that
    // moves or deletes; another account's subtree and the shared root are not
    // the caller's to consume either.
    const inbox = await mkdtemp(path.join(os.tmpdir(), 'ci-inbox-'));
    const root = await mkdtemp(path.join(os.tmpdir(), 'ci-roots-'));
    const rootFile = path.join(root, 'export.zip');

    await mkdir(path.join(inbox, 'kyle_lifescope.io'), { recursive: true });
    await mkdir(path.join(inbox, 'other_lifescope.io'), { recursive: true });

    const mine = path.join(inbox, 'kyle_lifescope.io', 'export.zip');
    const theirs = path.join(inbox, 'other_lifescope.io', 'export.zip');
    const shared = path.join(inbox, 'export.zip');

    await writeFile(mine, 'bytes');
    await writeFile(theirs, 'bytes');
    await writeFile(shared, 'bytes');
    await writeFile(rootFile, 'bytes');

    await withRoots([root], () =>
      withInbox(inbox, async () => {
        const email = 'kyle@lifescope.io';

        expect(await resolveWithinUserInbox(mine, email)).toContain('export.zip');

        for (const refused of [theirs, shared, rootFile]) {
          await expect(resolveWithinUserInbox(refused, email)).rejects.toBeInstanceOf(
            PathOutsideImportRootsError,
          );
        }
      }),
    );
  });
});

describe('resolveWithinRoots', () => {
  it('refuses everything over an empty root set', async () => {
    await expect(resolveWithinRoots('/etc/passwd', [])).rejects.toBeInstanceOf(PathOutsideImportRootsError);
  });
});
