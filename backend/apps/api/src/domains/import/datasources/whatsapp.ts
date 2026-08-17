/* WhatsApp — per-chat _chat.txt export (iOS and Android formats). */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { mediaItemForAsset, insideRoot } from './_ai_media';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

// iOS 12-hr: [M/D/YY, H:MM:SS AM] Sender: message
// iOS 24-hr: [M/D/YY, H:MM:SS] Sender: message  (common outside US)
// The space after the colon is optional: when a message's body starts with a
// newline (e.g. some multi-line/quoted messages), the header line ends right
// at the colon with nothing following. Requiring ": " (colon+space) made that
// header fail to match entirely, so it fell through to the continuation-line
// branch and got appended to the PREVIOUS (wrong-sender) message instead of
// starting its own — the source of the cross-sender content merging.
const IOS_RE =
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\] ([^:]+):[ ]?([\s\S]*)$/;
// Android: DD/MM/YYYY, HH:MM - Sender: message
const ANDROID_RE = /^(\d{2}\/\d{2}\/\d{4}), (\d{2}:\d{2}) - ([^:]+):[ ]?([\s\S]*)$/;

// WhatsApp's iOS export prefixes many lines — overwhelmingly the ones
// announcing an attachment or "omitted" media — with an invisible U+200E
// (LEFT-TO-RIGHT MARK) before the leading '['. IOS_RE/ANDROID_RE anchor on a
// literal opening character at line start, so an unstripped mark makes the
// header fail to match entirely, and the line falls through to the
// continuation branch and gets appended onto the PREVIOUS (wrong-sender)
// message. Strip a leading run of zero-width/bidi control marks once per
// line, before matching, rather than loosening the anchored regexes
// themselves (loosening risks new false-positive matches).
// U+200E/U+200F (LTR/RTL mark), U+202A-U+202E (bidi embed/override), and
// U+2066-U+2069 (bidi isolate) — the zero-width/bidi control marks WhatsApp
// (and other chat apps) sprinkle around punctuation for RTL-safe rendering.
const LEADING_INVISIBLE_RE = /^[‎‏‪-‮⁦-⁩]+/;
function stripLeadingInvisible(line: string): string {
  return line.replace(LEADING_INVISIBLE_RE, '');
}

interface ParsedLine {
  ts: Date | undefined;
  sender: string;
  text: string;
}

function parseWALine(line: string): ParsedLine | null {
  const cleaned = stripLeadingInvisible(line);
  let m = IOS_RE.exec(cleaned);
  if (m) {
    const ts = new Date(`${m[1]} ${m[2]}`);

    return { ts: isNaN(ts.getTime()) ? undefined : ts, sender: m[3].trim(), text: m[4] };
  }

  m = ANDROID_RE.exec(cleaned);
  if (m) {
    // Assume DD/MM/YYYY → YYYY-MM-DD
    const parts = m[1].split('/');
    const iso = `${parts[2]}-${parts[1]}-${parts[0]}T${m[2]}:00`;
    const ts = new Date(iso);

    return { ts: isNaN(ts.getTime()) ? undefined : ts, sender: m[3].trim(), text: m[4] };
  }

  return null;
}

const SYSTEM_RE =
  /^(Messages and calls are end-to-end encrypted|.+ (added|removed|left|created group|changed|deleted|updated))/i;

// Shared-location messages embed a maps link, e.g.
//   "location: https://maps.google.com/?q=37.7749,-122.4194"
//   "https://maps.google.com/maps/@37.77,-122.41,15z"
// Pull the first lat,long pair out of such a link so the pin lands on the map.
const GEO_RE = /(?:[?&]q=|maps\/@|\/@|q=loc:)(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/i;
function parseSharedLocation(text: string): { latitude: number; longitude: number } | undefined {
  if (!/location|maps\.|maps\?|maps\//i.test(text)) {
    return undefined;
  }

  const m = GEO_RE.exec(text);
  if (!m) {
    return undefined;
  }

  const latitude = parseFloat(m[1]);
  const longitude = parseFloat(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }

  return { latitude, longitude };
}

// A message whose body references an attached file — the bytes live
// alongside _chat.txt in the same export directory, but WhatsApp's exporter
// never puts the media inline; it only leaves a text marker in the transcript:
//   iOS:     "<attached: 00000048-PHOTO-2026-05-08-08-35-29.jpg>"
//   Android: "IMG-20260508-WA0001.jpg (file attached)"
// The two platforms use different markers, so both are checked.
const IOS_ATTACHED_RE = /<attached:\s*([^>]+?)>/i;
const ANDROID_ATTACHED_RE = /([^\s<>]+)\s+\(file attached\)/i;
function attachedFilename(text: string): string | undefined {
  const iosMatch = IOS_ATTACHED_RE.exec(text);
  if (iosMatch) {
    return iosMatch[1].trim();
  }

  const androidMatch = ANDROID_ATTACHED_RE.exec(text);
  if (androidMatch) {
    return androidMatch[1].trim();
  }

  return undefined;
}

export class WhatsAppFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const root = entry.fullPath || entry.fsRoot || entry.filename;
    if (!root) {
      return { confidence: 0 };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(root);
    } catch {
      return { confidence: 0 };
    }

    if (stat.isFile()) {
      const base = path.basename(root).toLowerCase();
      if (base === '_chat.txt') {
        return { confidence: 0.97 };
      }

      if (base.startsWith('whatsapp chat') && base.endsWith('.txt')) {
        return { confidence: 0.95 };
      }

      return { confidence: 0 };
    }

    if (stat.isDirectory()) {
      try {
        const names = fs.readdirSync(root).map((n) => n.toLowerCase());
        if (names.includes('_chat.txt')) {
          return { confidence: 0.97 };
        }

        if (names.some((n) => n.startsWith('whatsapp chat') && n.endsWith('.txt'))) {
          return { confidence: 0.95 };
        }
      } catch {
        /* ignore */
      }

      return { confidence: 0, dir_threshold: 0.7 };
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const root = entry.fullPath || entry.fsRoot || entry.filename;
    if (!root) {
      return;
    }

    let chatPath = root;
    try {
      if (fs.statSync(root).isDirectory()) {
        const names = fs.readdirSync(root);
        const found =
          names.find((n) => n.toLowerCase() === '_chat.txt') ||
          names.find((n) => /^whatsapp chat/i.test(n) && n.endsWith('.txt'));
        if (!found) {
          return;
        }

        chatPath = path.join(root, found);
      }
    } catch {
      return;
    }

    const conversationName =
      path
        .basename(path.dirname(chatPath))
        .replace(/^WhatsApp Chat( with| -)?/i, '')
        .trim() ||
      path.basename(chatPath, '.txt').replace(/_chat/i, '').trim() ||
      'Chat';

    // Attached media sits next to _chat.txt in the same export directory.
    const mediaDir = path.dirname(chatPath);

    const rl = readline.createInterface({
      input: fs.createReadStream(chatPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    let current: ParsedLine | null = null;
    let seq = 0;

    const flush = (p: ParsedLine) => {
      if (!timeframeContains(params.timeframe, p.ts)) {
        return;
      }

      if (SYSTEM_RE.test(p.text)) {
        return;
      }

      const loc = parseSharedLocation(p.text);

      // Resolve an attached-file reference to the sibling file on disk and
      // emit it as its own 'media' item (the text item below still carries
      // the transcript line, e.g. "<attached: X.jpg>", so nothing about the
      // original message is lost — this only adds the actual bytes).
      const attached = attachedFilename(p.text);
      if (attached) {
        // path.basename strips any directory components the reference might
        // (maliciously or accidentally) contain, so the resolved path can
        // never escape mediaDir.
        const base = path.basename(attached);
        const abs = path.join(mediaDir, base);
        if (base && insideRoot(mediaDir, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const mediaItem = mediaItemForAsset(
            `whatsapp:media:${conversationName}`,
            'WhatsApp',
            { abs, relKey: path.relative(mediaDir, abs) },
            p.ts,
            { Sender: p.sender, Conversation: conversationName },
          );
          if (mediaItem) {
            params.pipeline.push({
              item: mediaItem,
              edges: p.sender
                ? [{ relation: 'participant', to: { entity: { type: 'contact', name: p.sender } } }]
                : [],
            });
          } else {
            // Referenced file exists but isn't a photo/video (e.g. a .vcf
            // contact card or .opus voice note) — out of scope for a media
            // item; report it rather than silently doing nothing.
            params.pipeline.drop?.('whatsapp_attachment_unsupported', base);
          }
        } else {
          // Real export referenced a file that isn't sitting next to
          // _chat.txt (export truncated, media stripped before sharing,
          // etc.) — report the loss instead of silently dropping it.
          params.pipeline.drop?.('whatsapp_attachment_missing', base || attached);
        }
      }

      params.pipeline.push({
        item: {
          id: `whatsapp:${conversationName}:${p.ts ? p.ts.toISOString() : 'noTs'}:${seq++}`,
          classification: loc ? 'location' : 'message',
          timestamp: p.ts,
          ...(loc && { location: loc }),
          content: { filename: '_chat.txt', mediaType: 'text/plain', data: async () => Buffer.from(p.text) },
          metadata: {
            Sender: p.sender,
            Conversation: conversationName,
            Source: 'WhatsApp',
            // Surface the body in metadata so the canonical mapping (descriptionFor)
            // carries it through to CI-Server; otherwise it only lives in content.data.
            Text: p.text || undefined,
            ...(loc && { Location: `${loc.latitude}, ${loc.longitude}` }),
          },
        },
        // Link the message to whoever sent it, so the graph view gets a real
        // item↔entity edge. The sender name matches imported contacts (vCard) by
        // name when present, otherwise a lightweight contact entity is created.
        edges: p.sender
          ? [{ relation: 'participant', to: { entity: { type: 'contact', name: p.sender } } }]
          : [],
      });
    };

    for await (const line of rl) {
      const parsed = parseWALine(line);
      if (parsed) {
        if (current) {
          flush(current);
        }

        current = parsed;
      } else if (current) {
        current.text += '\n' + line;
      }
    }

    if (current) {
      flush(current);
    }
  }
}

registerDataSource({
  name: 'whatsapp',
  title: 'WhatsApp',
  icon: '',
  description: 'Per-chat WhatsApp message exports (text + media).',
  newFileImporter: () => new WhatsAppFileImporter(),
});
