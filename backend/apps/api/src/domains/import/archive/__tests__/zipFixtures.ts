/*
 * Hand-built zip fixtures.
 *
 * The archives that break extraction cannot be produced by the `zip` binary:
 * it sets general-purpose bit 11 ("names are UTF-8") whenever a name needs it,
 * which is exactly the flag Google Takeout leaves CLEAR and exactly why
 * Info-ZIP mis-reads those names. Writing the bytes by hand is the only way to
 * reproduce the shape, and it also means the archive tests need no `zip`
 * binary in CI's `node:22` image.
 *
 * Not a test file — `testMatch` is `*.test.ts`, so this is only ever imported.
 */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
}

export interface FixtureEntry {
  /**
   * The name as STORED. Pass a Buffer to write raw bytes that are not UTF-8 —
   * a genuine CP437 name, say — which a string cannot express.
   */
  name: string | Buffer;
  contents?: string | Buffer;
  /**
   * Set general-purpose bit 11. Defaults to FALSE, which is what Takeout
   * emits and what makes non-ASCII names go wrong.
   */
  utf8Flag?: boolean;
  /** Deflate the payload (method 8) instead of storing it (method 0). */
  deflate?: boolean;
}

/** A zip containing exactly these entries, in this order. */
export function buildZip(entries: FixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.contents) ? entry.contents : Buffer.from(entry.contents ?? '', 'utf8');
    const deflate = entry.deflate ?? false;
    const payload = deflate ? zlib.deflateRawSync(raw) : raw;
    const method = deflate ? 8 : 0;
    const flags = entry.utf8Flag ? 0x0800 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, payload]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42); // relative offset of local header
    centrals.push(Buffer.concat([central, name]));

    offset += 30 + name.length + payload.length;
  }

  const localChunk = Buffer.concat(locals);
  const centralChunk = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralChunk.length, 12);
  eocd.writeUInt32LE(localChunk.length, 16);

  return Buffer.concat([localChunk, centralChunk, eocd]);
}

/**
 * A one-entry, stored zip whose filename bytes are UTF-8 but whose
 * general-purpose bit 11 is left clear — i.e. what Google Takeout emits.
 */
export function zipWithoutUtf8Flag(filename: string, contents: string): Buffer {
  return buildZip([{ name: filename, contents }]);
}
