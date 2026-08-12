/*
 * The recursive unpack pass (archive/unpack.ts): archive reclamation and the two
 * preflights. Default behavior (keep zip + `.unpacked` marker) is unchanged;
 * run-owned scratch passes `deleteArchives` so each staged zip is reclaimed the
 * moment its extraction succeeds.
 *
 * An archive that cannot be read as a zip (a truncated download) is moved to
 * `.rejected/` and reported through `onRejected` — it no longer sits in place
 * being silently skipped, and it no longer blocks its readable siblings. The
 * disk preflight still fails the whole pass before anything extracts, since
 * there is nothing to set aside and retrying cannot help.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { unpackArchives, InsufficientDiskError, type RejectedArchive } from '../unpack';

function zipWith(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }

  return zip.toBuffer();
}

describe('unpackArchives', () => {
  const dirs: string[] = [];
  const dir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-unpack-'));
    dirs.push(d);

    return d;
  };

  afterEach(() => {
    jest.restoreAllMocks();
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('by default keeps the zip and writes the .unpacked marker (unchanged behavior)', () => {
    const d = dir();
    const archive = path.join(d, 'export.zip');
    fs.writeFileSync(archive, zipWith({ 'walk.gpx': '<gpx/>' }));

    const res = unpackArchives(d);
    expect(res).toHaveLength(1);
    expect(fs.existsSync(path.join(d, 'walk.gpx'))).toBe(true);
    expect(fs.existsSync(archive)).toBe(true);
    expect(fs.existsSync(`${archive}.unpacked`)).toBe(true);
  });

  it('deleteArchives reclaims each zip after its extraction and writes no marker', () => {
    const d = dir();
    const a = path.join(d, 'part-1.zip');
    const b = path.join(d, 'part-2.zip');
    fs.writeFileSync(a, zipWith({ 'one.txt': '1' }));
    fs.writeFileSync(b, zipWith({ 'two.txt': '2' }));

    const res = unpackArchives(d, undefined, { deleteArchives: true });
    expect(res).toHaveLength(2);
    expect(fs.existsSync(path.join(d, 'one.txt'))).toBe(true);
    expect(fs.existsSync(path.join(d, 'two.txt'))).toBe(true);
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
    expect(fs.existsSync(`${a}.unpacked`)).toBe(false);
    expect(fs.existsSync(`${b}.unpacked`)).toBe(false);
  });

  it('quarantines a TRUNCATED zip (the real OneDrive failure) and says the download did not finish', () => {
    const d = dir();
    const full = zipWith({ 'photos/img.jpg': 'bytes', 'notes.txt': 'hello' });
    const archive = path.join(d, 'OneDrive_2.zip');
    // Cut the end-of-central-directory record off a VALID archive: complete
    // entries, no EOCD — exactly what a download that stopped early leaves.
    fs.writeFileSync(archive, full.subarray(0, full.length - 40));

    const rejected: RejectedArchive[] = [];
    const logs: string[] = [];
    expect(unpackArchives(d, (m) => logs.push(m), { onRejected: (r) => rejected.push(r) })).toHaveLength(0);

    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/truncated .* end-of-central-directory record is missing/);
    expect(rejected[0].movedTo).toBe(path.join(d, '.rejected', 'OneDrive_2.zip'));
    expect(logs.some((m) => m.startsWith('REJECTED OneDrive_2.zip'))).toBe(true);
    // Nothing was extracted from it, and its bytes are still recoverable.
    expect(fs.existsSync(path.join(d, 'notes.txt'))).toBe(false);
    expect(fs.existsSync(archive)).toBe(false);
    expect(fs.existsSync(path.join(d, '.rejected', 'OneDrive_2.zip'))).toBe(true);
  });

  it('reports every bad archive while the good ones still import', () => {
    const d = dir();
    const full = zipWith({ 'a.txt': 'a' });
    fs.writeFileSync(path.join(d, 'part-1.zip'), full.subarray(0, full.length - 40));
    fs.writeFileSync(path.join(d, 'part-2.zip'), Buffer.alloc(0));
    fs.writeFileSync(path.join(d, 'part-3.zip'), zipWith({ 'c.txt': 'c' }));

    const rejected: RejectedArchive[] = [];
    const res = unpackArchives(d, undefined, {
      deleteArchives: true,
      onRejected: (r) => rejected.push(r),
    });

    expect(res.map((r) => path.basename(r.archive))).toEqual(['part-3.zip']);
    expect(fs.existsSync(path.join(d, 'c.txt'))).toBe(true);
    expect(rejected.map((r) => path.basename(r.archive)).sort()).toEqual(['part-1.zip', 'part-2.zip']);
    expect(rejected.find((r) => r.archive.endsWith('part-2.zip'))?.reason).toMatch(/empty/);
    // deleteArchives reclaims the good one; the bad ones are kept, set aside.
    expect(fs.existsSync(path.join(d, 'part-3.zip'))).toBe(false);
    expect(fs.existsSync(path.join(d, '.rejected', 'part-1.zip'))).toBe(true);
    expect(fs.existsSync(path.join(d, '.rejected', 'part-2.zip'))).toBe(true);
  });

  it('still flattens a Takeout/ wrapper when archives are reclaimed', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'takeout-001.zip'), zipWith({ 'Takeout/Google Photos/img.jpg': 'bytes' }));
    unpackArchives(d, undefined, { deleteArchives: true });
    expect(fs.existsSync(path.join(d, 'Google Photos', 'img.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(d, 'Takeout'))).toBe(false);
  });

  it('fails the whole pass up front (nothing extracted) when free disk cannot fit the declared bytes', () => {
    const d = dir();
    const archive = path.join(d, 'export.zip');
    fs.writeFileSync(archive, zipWith({ 'walk.gpx': '<gpx/>' }));

    jest.spyOn(fs, 'statfsSync').mockReturnValue({
      bavail: 1,
      bsize: 1,
    } as unknown as fs.StatsFsBase<number>);

    expect(() => unpackArchives(d)).toThrow(InsufficientDiskError);
    expect(() => unpackArchives(d)).toThrow(/not enough disk space/);
    expect(fs.existsSync(path.join(d, 'walk.gpx'))).toBe(false);
    expect(fs.existsSync(archive)).toBe(true);
  });

  it('skips the preflight (extracts normally) when statfs is unavailable', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'export.zip'), zipWith({ 'walk.gpx': '<gpx/>' }));
    jest.spyOn(fs, 'statfsSync').mockImplementation(() => {
      throw new Error('ENOSYS');
    });
    expect(unpackArchives(d)).toHaveLength(1);
    expect(fs.existsSync(path.join(d, 'walk.gpx'))).toBe(true);
  });
});
