/* Minimal MIME parsing utility for email/gmail datasources (incremental).
   Supports single-level multipart with alternative & attachments.
   NOT implementing full RFC 2047/2231. */
import { Buffer } from 'node:buffer';

export interface ParsedAttachment {
  filename?: string;
  mediaType?: string;
  data: Buffer;
}
export interface ParsedMimeResult {
  textBody?: string;
  htmlBody?: string;
  attachments: ParsedAttachment[];
}

export function parseMime(rawHeaders: string, body: string): ParsedMimeResult {
  const headers = headerMap(rawHeaders);
  const contentTypeHeader = headers['content-type'] || '';
  const contentType = contentTypeHeader.toLowerCase();
  const transferEncoding = (headers['content-transfer-encoding'] || '').toLowerCase();

  // If multipart, split and recurse (one level deep)
  if (contentType.startsWith('multipart/')) {
    // Extract boundary from original (case-preserved) header so we retain exact boundary token case
    const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentTypeHeader);
    if (!boundaryMatch) {
      return { attachments: [] };
    }

    const boundary = boundaryMatch[1];
    const parts = splitMultipart(body, boundary);
    const result: ParsedMimeResult = { attachments: [] };
    for (const part of parts) {
      const { headersRaw, bodyRaw } = separateHeaders(part);
      const partHeaders = headerMap(headersRaw);
      const partContentTypeHeader = partHeaders['content-type'] || 'text/plain';
      const ct = partContentTypeHeader.toLowerCase();
      const disp = (partHeaders['content-disposition'] || '').toLowerCase();
      const data = decodeBody(bodyRaw, partHeaders['content-transfer-encoding']);
      if (ct.startsWith('multipart/')) {
        // one-level recursion
        const inner = parseMime(headersRaw, bodyRaw); // recursion maintains boundary case for nested multipart
        // merge inner results
        if (inner.textBody && !result.textBody) {
          result.textBody = inner.textBody;
        }

        if (inner.htmlBody && !result.htmlBody) {
          result.htmlBody = inner.htmlBody;
        }

        result.attachments.push(...inner.attachments);
        continue;
      }

      if (ct.startsWith('text/plain') && !result.textBody) {
        result.textBody = data.toString('utf8');
        continue;
      }

      if (ct.startsWith('text/html') && !result.htmlBody) {
        result.htmlBody = data.toString('utf8');
        continue;
      }

      const filename =
        extractFilename(partHeaders['content-disposition']) || extractFilename(partHeaders['content-type']);
      if (disp.startsWith('attachment') || filename) {
        result.attachments.push({ filename, mediaType: ct.split(';')[0], data });
      }
    }

    return result;
  }

  // Single part
  const decoded = decodeBody(body, transferEncoding);
  if (contentType.startsWith('text/html')) {
    return { htmlBody: decoded.toString('utf8'), attachments: [] };
  }

  return { textBody: decoded.toString('utf8'), attachments: [] };
}

function headerMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of raw.split(/\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) {
      continue;
    }

    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (!map[k]) {
      map[k] = v;
    } else {
      map[k] += ', ' + v;
    }
  }

  return map;
}

function separateHeaders(raw: string): { headersRaw: string; bodyRaw: string } {
  const parts = raw.split(/\n\n/);
  if (parts.length < 2) {
    return { headersRaw: raw, bodyRaw: '' };
  }

  return { headersRaw: parts[0].replace(/\n[ \t]+/g, ' '), bodyRaw: parts.slice(1).join('\n\n') };
}

function splitMultipart(fullBody: string, boundary: string): string[] {
  const lines = (fullBody.endsWith('\n') ? fullBody : fullBody + '\n').split(/\n/);
  const parts: string[] = [];
  let current: string[] = [];
  const boundaryLine = '--' + boundary;
  for (const line of lines) {
    if (line.startsWith(boundaryLine)) {
      if (current.length) {
        parts.push(current.join('\n').trim());
        current = [];
      }

      if (line.startsWith(boundaryLine + '--')) {
        // closing boundary; stop collecting further
        break;
      }

      continue; // start next part
    }

    current.push(line);
  }

  return parts.filter((p) => p);
}

function decodeBody(body: string, cte?: string): Buffer {
  const enc = (cte || '').toLowerCase();
  if (enc === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, '').trim(), 'base64');
    } catch {
      return Buffer.from(body);
    }
  }

  if (enc === 'quoted-printable') {
    return Buffer.from(
      body
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
      'utf8',
    );
  }

  return Buffer.from(body, 'utf8');
}

function extractFilename(headerValue?: string): string | undefined {
  if (!headerValue) {
    return undefined;
  }

  const m = /filename="?([^";]+)"?/i.exec(headerValue);

  return m?.[1];
}

// RFC 2047 encoded-word decoding for header fields. Handles both Q (quoted-
// printable variant with underscore-as-space) and B (base64) encodings.
// Per RFC 2047 §6.2 any whitespace BETWEEN adjacent encoded-words is folded
// away ("=?…?= =?…?=" → concatenated), but whitespace between an encoded
// word and an ascii run is preserved.
const ENCODED_WORD_RE = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

function decodeQEncoded(payload: string): Buffer {
  // Q-encoding: underscore = space, =XX = byte. Decode to raw bytes so the
  // following charset conversion sees the correct byte sequence.
  const bytes: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    const c = payload[i];
    if (c === '_') {
      bytes.push(0x20);
    } else if (c === '=' && i + 2 < payload.length) {
      const hex = payload.slice(i + 1, i + 3);
      const n = parseInt(hex, 16);
      if (Number.isNaN(n)) {
        bytes.push(c.charCodeAt(0));
      } else {
        bytes.push(n);
        i += 2;
      }
    } else {
      bytes.push(c.charCodeAt(0));
    }
  }

  return Buffer.from(bytes);
}

export function decodeHeaderField(raw: string): string {
  if (!raw || !raw.includes('=?')) {
    return raw;
  }

  // First pass: replace each encoded-word with its decoded text. Remember
  // the surrounding character so we can later collapse whitespace between
  // adjacent encoded words.
  type Token = { kind: 'enc'; text: string } | { kind: 'lit'; text: string };
  const tokens: Token[] = [];
  let lastIdx = 0;
  for (const m of raw.matchAll(ENCODED_WORD_RE)) {
    if (m.index! > lastIdx) {
      tokens.push({ kind: 'lit', text: raw.slice(lastIdx, m.index!) });
    }

    const [, charset, scheme, payload] = m;
    let decoded: Buffer;
    try {
      if (scheme.toUpperCase() === 'B') {
        decoded = Buffer.from(payload, 'base64');
      } else {
        decoded = decodeQEncoded(payload);
      }

      const text = decoded.toString(
        (charset.toLowerCase() === 'us-ascii' ? 'ascii' : 'utf8') as BufferEncoding,
      );
      tokens.push({ kind: 'enc', text });
    } catch {
      tokens.push({ kind: 'lit', text: m[0] });
    }

    lastIdx = m.index! + m[0].length;
  }

  if (lastIdx < raw.length) {
    tokens.push({ kind: 'lit', text: raw.slice(lastIdx) });
  }

  // Collapse whitespace between two adjacent encoded-words.
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (
      t.kind === 'lit' &&
      /^\s+$/.test(t.text) &&
      i > 0 &&
      i < tokens.length - 1 &&
      tokens[i - 1].kind === 'enc' &&
      tokens[i + 1].kind === 'enc'
    ) {
      continue;
    }

    out += t.text;
  }

  return out;
}
