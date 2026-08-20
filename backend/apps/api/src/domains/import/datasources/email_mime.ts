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

/** The five predefined XML entities plus the ones real mail actually uses. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** A numeric entity's character, or '' when the code point is not representable. */
function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return '';
  }

  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Flatten an HTML mail body to readable plain text — dependency-free.
 *
 * WHY. A receipt is very often HTML-ONLY (no text/plain alternative), and
 * {@link parseMime} hands that body back as raw markup. Everything downstream
 * then reads tag soup: the metadata `Text` snippet is `<table style=…`, the
 * receipt detector's body signal cannot see the total through the attributes,
 * and the embedding indexes CSS. This is the smallest transform that makes such
 * a body mean something:
 *
 *   - `<script>` / `<style>` blocks are removed WITH their contents (CSS and JS
 *     are not text the user wrote).
 *   - `<br>`, `</p>`, `</tr>`, `</div>`, block ends → newline; `</td>`/`</th>`
 *     → tab, so a receipt's item/price columns stay side by side and a total
 *     stays next to its label.
 *   - every other tag is dropped, entities decoded (`&amp;`, `&nbsp;`, `&#39;`,
 *     `&#x27;`), and runs of blank lines collapsed.
 *
 * Not an HTML parser and not trying to be: no DOM, no nesting rules, no
 * attribute semantics. It converts markup to text well enough to read, which is
 * strictly more than the raw markup did.
 */
export function htmlToText(html: string | undefined | null): string {
  if (!html) {
    return '';
  }

  let out = html
    // Drop script/style/comment noise with their contents.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Cell boundaries become tabs so a label and its amount stay on one line.
    .replace(/<\/\s*(?:td|th)\s*>/gi, '\t')
    // Line-breaking elements become newlines.
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:p|div|tr|table|li|ul|ol|h[1-6]|blockquote|section|article|header|footer)\s*>/gi, '\n')
    .replace(/<\s*(?:p|div|tr|li|h[1-6])\b[^>]*>/gi, '\n')
    // Everything else: gone.
    .replace(/<[^>]*>/g, '');

  out = out
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);

  return (
    out
      // Non-breaking space is whitespace once decoded; keep it from gluing words.
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[ \t]+|[ \t]+$/gm, '')
      .trim()
  );
}

/**
 * The readable body of a parsed message: the text/plain part when the sender
 * provided one, else the HTML part flattened by {@link htmlToText}.
 */
export function readableBody(mime: ParsedMimeResult): string {
  return mime.textBody || htmlToText(mime.htmlBody);
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
