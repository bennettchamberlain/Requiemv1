import { describe, expect, it } from 'vitest';

import { zipFilesStore } from './zipStore';

/**
 * A from-scratch, independent zip reader for these tests — deliberately NOT
 * sharing a line with `zipStore.ts`. A test that decodes with the same table
 * it encoded with would pass even if both were wrong the same way; this reads
 * the raw bytes back out against the plain zip spec (local file headers,
 * central directory, end-of-central-directory record) and is the only thing
 * in this file that proves the encoder's OUTPUT is a real zip, not just that
 * its functions returned without throwing.
 */

interface DecodedEntry {
  name: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Uint8Array;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Walks LOCAL file headers from byte 0 until the central directory begins. */
function readLocalEntries(bytes: Uint8Array): DecodedEntry[] {
  const view = viewOf(bytes);
  const entries: DecodedEntry[] = [];
  let offset = 0;

  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const crc32 = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;

    entries.push({
      name,
      crc32,
      compressedSize,
      uncompressedSize,
      data: bytes.slice(dataStart, dataStart + compressedSize),
    });
    offset = dataStart + compressedSize;
  }

  return entries;
}

interface Eocd {
  signature: number;
  totalEntries: number;
  centralDirSize: number;
  centralDirOffset: number;
}

/** This encoder never writes a file comment, so the record is the final 22 bytes. */
function readEocd(bytes: Uint8Array): Eocd {
  const view = viewOf(bytes);
  const at = bytes.length - 22;

  return {
    signature: view.getUint32(at, true),
    totalEntries: view.getUint16(at + 10, true),
    centralDirSize: view.getUint32(at + 12, true),
    centralDirOffset: view.getUint32(at + 16, true),
  };
}

interface CentralEntry {
  name: string;
  crc32: number;
  localHeaderOffset: number;
}

function readCentralEntries(bytes: Uint8Array, eocd: Eocd): CentralEntry[] {
  const view = viewOf(bytes);
  const entries: CentralEntry[] = [];
  let offset = eocd.centralDirOffset;
  const end = eocd.centralDirOffset + eocd.centralDirSize;

  while (offset < end) {
    const nameLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 46;

    entries.push({
      name: new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength)),
      crc32: view.getUint32(offset + 16, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset = nameStart + nameLength;
  }

  return entries;
}

function bytesOf(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Standard CRC-32 (the zip/PNG polynomial, 0xEDB88320), coded independently
 * of `zipStore.ts`'s own table-driven version — checking a value the encoder
 * computed against a second implementation of the same standard, not against
 * itself.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function fileAt(path: string, content: string): File {
  const file = new File([content], path.split('/').pop()!);

  Object.defineProperty(file, 'webkitRelativePath', { value: path });

  return file;
}

describe('zipFilesStore', () => {
  it('builds a zip whose local header decodes back to the real name, bytes and CRC', async () => {
    const conversations = fileAt('chatgpt-export/conversations.json', '{"mapping":{}}');

    const zip = await zipFilesStore([conversations]);
    const bytes = await bytesOf(zip);

    expect(zip.name).toBe('chatgpt-export.zip');
    expect(zip.type).toBe('application/zip');

    const [entry] = readLocalEntries(bytes);

    expect(entry.name).toBe('chatgpt-export/conversations.json');
    expect(new TextDecoder().decode(entry.data)).toBe('{"mapping":{}}');
    // Not just "some CRC was written" — the exact standard CRC-32 of this
    // file's bytes, recomputed by an independent implementation above.
    expect(entry.crc32).toBe(crc32(new TextEncoder().encode('{"mapping":{}}')));
    expect(entry.compressedSize).toBe(entry.uncompressedSize); // STORE, never shrinks or grows
  });

  it('packs every file with its own path, content and CRC — and the central directory agrees', async () => {
    const files = [
      fileAt('export/conversations.json', '{"mapping":{"a":1}}'),
      fileAt('export/media/avatar.png', 'not-really-a-png-but-bytes-all-the-same'),
      fileAt('export/media/nested/clip.mp4', 'video-bytes'),
    ];

    const zip = await zipFilesStore(files);
    const bytes = await bytesOf(zip);

    const locals = readLocalEntries(bytes);
    const eocd = readEocd(bytes);
    const centrals = readCentralEntries(bytes, eocd);

    expect(eocd.signature).toBe(0x06054b50);
    expect(eocd.totalEntries).toBe(3);

    expect(locals.map((entry) => entry.name)).toEqual([
      'export/conversations.json',
      'export/media/avatar.png',
      'export/media/nested/clip.mp4',
    ]);
    expect(centrals.map((entry) => entry.name)).toEqual(locals.map((entry) => entry.name));

    // Every entry's own CRC-32 is independently correct, not just copied
    // from a neighbour or left at zero.
    for (const [i, local] of locals.entries()) {
      const expectedContent = ['{"mapping":{"a":1}}', 'not-really-a-png-but-bytes-all-the-same', 'video-bytes'][i];

      expect(new TextDecoder().decode(local.data)).toBe(expectedContent);
      expect(local.crc32).toBe(crc32(new TextEncoder().encode(expectedContent)));
      // The central directory's copy of the CRC must match the local header's.
      expect(centrals[i].crc32).toBe(local.crc32);
    }

    // Each central-directory record points at a REAL local header — the
    // proof the archive is one coherent structure, not two halves that
    // happen to list the same names.
    let expectedOffset = 0;

    for (const [i, local] of locals.entries()) {
      expect(centrals[i].localHeaderOffset).toBe(expectedOffset);
      expectedOffset += 30 + local.name.length + local.compressedSize;
    }
  });

  it('rejects an empty file list instead of producing a hollow archive', async () => {
    await expect(zipFilesStore([])).rejects.toThrow('Nothing to pack');
  });

  it('reports progress once per file, in order, ending at the total', async () => {
    const files = [fileAt('bundle/a.txt', 'a'), fileAt('bundle/b.txt', 'b'), fileAt('bundle/c.txt', 'c')];
    const seen: Array<[number, number]> = [];

    await zipFilesStore(files, (done, total) => seen.push([done, total]));

    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});
