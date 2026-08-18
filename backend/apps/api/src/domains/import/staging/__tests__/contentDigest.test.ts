import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { digestFile, MAX_DIGEST_BYTES } from '../contentDigest';

/**
 * `digestFile` had no test at all before this file (nothing under
 * `staging/__tests__` names it, and every identity/`StagedWriter` fixture is a
 * tiny in-memory string). The cap in particular: files over
 * {@link MAX_DIGEST_BYTES} skip hashing and fall back to
 * `identity.ts`'s `degenerateDiscriminator`, which discriminates on the file's
 * PATH instead — the exact same same-basename-collision failure mode
 * `stagedIdentity.integration.spec.ts` was built to fix for undated files, just
 * triggered by size instead. Two same-named multi-GB videos sitting in
 * different album folders would collapse onto one staged row with nothing
 * here catching it.
 *
 * The over-cap case uses a SPARSE file (`ftruncate` past the cap with nothing
 * written) rather than an actual multi-gigabyte fixture: the code keys off
 * `stat().size`, which a sparse file reports honestly, so the branch is
 * reachable without the test suite actually writing 2GiB to disk. If
 * `digestFile` ever regressed into reading the file anyway, streaming a real
 * sha256 over even a sparse multi-GiB file takes long enough to blow this
 * file's default jest timeout — so a regression here fails loudly rather than
 * just running slow and unnoticed.
 */

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ci-contentdigest-'));
}

describe('digestFile', () => {
  let work: string;

  beforeEach(() => {
    work = scratch();
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('hashes a real file under the cap and reports its size', async () => {
    const file = path.join(work, 'small.txt');
    const contents = 'the quick brown fox';
    fs.writeFileSync(file, contents);

    const digest = await digestFile(file);

    expect(digest).toEqual({
      sha256: createHash('sha256').update(contents).digest('hex'),
      sizeBytes: Buffer.byteLength(contents),
    });
  });

  it('is null for a path that does not exist', async () => {
    expect(await digestFile(path.join(work, 'nope.txt'))).toBeNull();
  });

  it('is null for a directory rather than a file', async () => {
    const dir = path.join(work, 'a-directory');
    fs.mkdirSync(dir);

    expect(await digestFile(dir)).toBeNull();
  });

  it('falls back to null for a file over MAX_DIGEST_BYTES, without reading its bytes', async () => {
    const huge = path.join(work, 'huge-video.mp4');
    // A sparse file: this allocates no real disk blocks and writes nothing,
    // but `stat().size` reports the logical length honestly — which is all
    // `digestFile`'s cap check reads.
    const fd = fs.openSync(huge, 'w');
    fs.ftruncateSync(fd, MAX_DIGEST_BYTES + 1);
    fs.closeSync(fd);

    expect(fs.statSync(huge).size).toBe(MAX_DIGEST_BYTES + 1);

    const digest = await digestFile(huge);

    expect(digest).toBeNull();
  });
});
