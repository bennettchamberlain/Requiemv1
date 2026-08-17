/* Google Voice datasource (simplified TypeScript port) */
import fs from 'node:fs';
import path from 'node:path';

import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, EntityAttribute } from './timeline';

type GoogleVoiceOptions = Record<string, never>;

interface GVEntity {
  name?: string;
  phone?: string;
}

export class GoogleVoiceFileImporter implements FileImporter {
  private owner?: { name?: string; phones: string[] };

  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const full = entry.fullPath || entry.fsRoot || entry.filename;
    if (!full) {
      return { confidence: 0 };
    }

    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      let score = 0;
      const entries = fs.readdirSync(full);
      if (entries.includes('Phones.vcf')) {
        score += 0.4;
      } // phonebook vCard

      if (entries.includes('Bills.html')) {
        score += 0.15;
      } // billing history file

      if (entries.includes('Calls')) {
        score += 0.6;
      } // conversations root

      // boost if any HTML conversation files exist under Calls (partial export)
      try {
        const callsPath = path.join(full, 'Calls');
        if (fs.existsSync(callsPath)) {
          const hasHtml = fs.readdirSync(callsPath).some((f) => f.toLowerCase().endsWith('.html'));
          if (hasHtml) {
            score += 0.1;
          }
        }
      } catch {
        /* ignore */
      }

      if (path.basename(full) === 'Voice') {
        score += 0.05;
      } // directory named Voice

      return { confidence: score, dir_threshold: 0.7 };
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const root = entry.fullPath || entry.fsRoot || entry.filename;
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return;
    }

    // attempt to parse Phones.vcf for owner numbers (very naive vCard parser)
    try {
      const vcfPath = path.join(root, 'Phones.vcf');
      if (fs.existsSync(vcfPath)) {
        const data = await fs.promises.readFile(vcfPath, 'utf8');
        const cards = data.split(/END:VCARD/); // crude
        for (const card of cards) {
          if (!card.includes('BEGIN:VCARD')) {
            continue;
          }

          // Split on \r?\n (not just \n): a spec-compliant vCard uses CRLF line
          // endings. Splitting on \n alone leaves a trailing "\r" on every line,
          // so a blank "FN:\r\n" line parses as name "\r" — a single, truthy,
          // non-empty carriage-return character — which then wins the `||`
          // fallback below over the real phone number. Trimming each line (and
          // the parsed value) keeps a genuinely blank FN falsy so the fallback
          // to phones[0] actually fires.
          const lines = card.split(/\r?\n/).map((l) => l.trim());
          const nameLine = lines.find((l) => /^FN[:;]/.test(l));
          const tels = lines.filter((l) => /^TEL[:;]/.test(l));
          const name = nameLine?.split(/:/)[1]?.trim();
          this.owner = {
            name: name || undefined,
            phones: tels.map((t) => t.split(/:/)[1]?.trim()).filter((p): p is string => Boolean(p)),
          };
          break; // take first
        }
      }
    } catch (e) {
      params.log?.('warn', 'googlevoice owner parse failed', { error: (e as Error).message });
    }

    const callsDir = path.join(root, 'Calls');
    if (!fs.existsSync(callsDir)) {
      return;
    }

    for await (const f of this.walkDir(callsDir)) {
      if (!f.toLowerCase().endsWith('.html')) {
        continue;
      }

      await this.processConversation(f, params);
    }
  }

  private async *walkDir(root: string): AsyncGenerator<string> {
    const ents = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of ents) {
      const full = path.join(root, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) {
          continue;
        }

        yield* this.walkDir(full);
      } else if (e.isFile()) {
        yield full;
      }
    }
  }

  private async processConversation(fpath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', 'read google voice html failed', {
        file: path.basename(fpath),
        error: (e as Error).message,
      });

      return;
    }

    // Conversation label = the contact name/number before " - <Type> - " in the filename
    // (e.g. "+1206… - Text - 2025-11-26T…Z.html").
    const conversation =
      path
        .basename(fpath)
        .replace(/\s*-\s*(Text|Received|Placed|Missed|Voicemail|Recorded|Group Conversation)\b[\s\S]*$/i, '')
        .trim() || undefined;

    // Call / voicemail records ("Missed"/"Placed"/"Received"/"Recorded"/"Voicemail"
    // HTML files) use a completely different markup shape: a single
    // <div class="haudio"> block (hAudio microformat) with <abbr class="published">
    // / <abbr class="duration"> and, for voicemails, a <span class="note">
    // transcript — never a <div class="message"> or a <q> text body. The
    // msgRegex below doesn't match haudio divs at all, so without this branch
    // every call/voicemail file silently produced zero items. Route them to a
    // dedicated handler instead of falling into the SMS/MMS message loop.
    if (/<div class="haudio"/i.test(raw)) {
      this.processCallLog(raw, fpath, conversation, params);

      return;
    }

    // Each message is a flat <div class="message"> … </div> block. The real Google
    // Voice HTML uses <abbr class="dt" title="ISO">, a <cite class="sender vcard">
    // with <a class="tel" href="tel:…"><span class="fn">name</span></a>, then the
    // body in <q>…</q>. Pull each field independently (order-tolerant).
    const msgRegex = /<div class="message[^"]*">([\s\S]*?)<\/div>/gi;
    let match: RegExpExecArray | null;
    const participants: Record<string, GVEntity> = {};
    // The non-'Me' party in the file is the conversation contact; sender 'Me'
    // marks an outbound message. Track the contact so an outbound message (whose
    // only sender is 'Me') still gets a resolvable recipient. The owner (from
    // Phones.vcf) is the recipient of inbound messages.
    let contactName: string | undefined;
    let contactPhone: string | undefined;
    const owner = this.owner?.name || this.owner?.phones?.[0];
    while ((match = msgRegex.exec(raw)) !== null) {
      const block = match[1];
      const qHtml = /<q>([\s\S]*?)<\/q>/i.exec(block)?.[1];
      if (qHtml == null) {
        continue;
      } // call log / missed call without a text body

      const text = decodeHtml(stripTags(qHtml)).trim();
      const whenStr = /<(?:abbr|span) class="dt"[^>]*title="([^"]+)"/i.exec(block)?.[1];
      const ts = whenStr ? new Date(whenStr) : undefined;
      const sender = extractSender(block);
      if (sender.phone) {
        participants[sender.phone] = sender;
      }

      const isOutbound = (sender.name || '').trim().toLowerCase() === 'me';
      if (!isOutbound) {
        if (sender.name) {
          contactName = sender.name;
        }

        if (sender.phone) {
          contactPhone = sender.phone;
        }
      }

      const counterpart = contactName || contactPhone || conversation;
      // Outbound: Sender='Me' is the from, the contact is the recipient (To).
      // Inbound: Sender=contact is the from; the owner is the recipient.
      const to = isOutbound ? counterpart : owner;
      params.pipeline.push({
        item: {
          classification: 'message',
          timestamp: ts && !isNaN(ts.getTime()) ? ts : undefined,
          intermediateLocation: fpath,
          content: {
            filename: path.basename(fpath),
            mediaType: 'text/plain',
            data: async () => Buffer.from(text),
          },
          metadata: {
            Source: 'GoogleVoice',
            Sender: sender.name || sender.phone || undefined,
            Conversation: conversation,
            Text: text || undefined,
            Direction: isOutbound ? 'outgoing' : 'incoming',
            To: to || undefined,
          },
        },
      });
    }

    // Distinct participants → one contact entity each (per file).
    for (const p of Object.values(participants)) {
      if (!p.phone && !p.name) {
        continue;
      }

      params.pipeline.push({
        entity: {
          name: p.name || p.phone,
          attributes: p.phone ? [{ name: 'phone', value: p.phone, identity: true } as EntityAttribute] : [],
        },
      });
    }

    // attachments (image inference) - look for <img src="stub"> and attempt .jpg/.gif in same folder
    const imgStubRegex = /<img[^>]*src="([^"]+)"/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgStubRegex.exec(raw)) !== null) {
      const stub = imgMatch[1];
      const filename = resolveAttachment(stub, path.dirname(fpath));
      if (!filename) {
        continue;
      }

      const item = {
        classification: 'message',
        timestamp: tsFromAttachmentFilename(filename),
        intermediateLocation: filename,
        content: {
          filename: path.basename(filename),
          mediaType: '',
          data: async () => fs.promises.readFile(filename),
        },
        metadata: { Source: 'GoogleVoice', Attachment: 'image' },
      };
      params.pipeline.push({ item });
    }
  }

  // Call / voicemail record (hAudio microformat): one <div class="haudio"> per
  // file. Shape (matching real Google Voice Takeout exports):
  //   <div class="haudio">
  //     <span class="fn">Missed call from <a class="tel" href="tel:+1…">
  //       <span class="fn">Name</span></a></span>
  //     <abbr class="published" title="2025-01-15T09:30:00.000Z">…</abbr>
  //     <abbr class="duration" title="00:01:15">(00:01:15)</abbr>
  //     <span class="note">voicemail transcript text</span>   (voicemail only)
  //   </div>
  // Call direction/type (Missed/Placed/Received/Voicemail/Recorded) is most
  // reliably read from the filename — Google Voice names each call-log file
  // "<contact> - <Type> - <timestamp>.html", and this file already parses that
  // suffix for `conversation` above — rather than a class name in the markup,
  // which isn't consistent across call types. Emitted as classification 'call'
  // to match the shape sms_backup_restore.ts already uses for real call
  // records (Contact/Number/Duration/DurationUnit/Direction/Source/Description).
  private processCallLog(
    raw: string,
    fpath: string,
    conversation: string | undefined,
    params: ImportParams,
  ): void {
    const publishedMatch = /<abbr class="published"[^>]*\b(?:title|datetime)="([^"]+)"/i.exec(raw);
    const whenStr = publishedMatch?.[1];
    const ts = whenStr ? new Date(whenStr) : undefined;

    const durationMatch = /<abbr class="duration"[^>]*\b(?:title|datetime)="([^"]+)"/i.exec(raw);
    const durationSeconds = durationMatch ? parseDurationToSeconds(durationMatch[1]) : undefined;

    const typeMatch = /-\s*(Missed|Placed|Received|Voicemail|Recorded)\b/i.exec(path.basename(fpath));
    const callType = typeMatch ? typeMatch[1] : 'Unknown';
    const directionMap: Record<string, string> = {
      missed: 'missed',
      placed: 'outgoing',
      received: 'incoming',
      voicemail: 'incoming',
      recorded: 'incoming',
    };
    const direction = directionMap[callType.toLowerCase()] || 'unknown';

    // Contact: prefer a tel/fn pair inside the haudio block (same markup the
    // <q> message path already knows how to read), fall back to the filename
    // label parsed as `conversation` above.
    const sender = extractSender(raw);
    const contact = sender.name || sender.phone || conversation;

    const noteMatch = /<span class="note">([\s\S]*?)<\/span>/i.exec(raw);
    const transcript = noteMatch ? decodeHtml(stripTags(noteMatch[1])).trim() : undefined;

    const preposition = direction === 'outgoing' ? 'to' : 'from';
    const contentStr = `${callType} call ${preposition} ${contact || 'unknown'}`;

    params.pipeline.push({
      item: {
        classification: 'call',
        timestamp: ts && !isNaN(ts.getTime()) ? ts : undefined,
        intermediateLocation: fpath,
        content: {
          filename: path.basename(fpath),
          mediaType: 'text/plain',
          data: async () => Buffer.from(transcript || contentStr),
        },
        metadata: {
          Source: 'GoogleVoice',
          Contact: contact || undefined,
          Number: sender.phone || undefined,
          Conversation: conversation,
          CallType: callType,
          Direction: direction,
          Duration: durationSeconds,
          DurationUnit: durationSeconds != null ? 'seconds' : undefined,
          Transcript: transcript || undefined,
          Description: contentStr,
        },
      },
    });

    if (sender.phone || sender.name) {
      params.pipeline.push({
        entity: {
          name: sender.name || sender.phone,
          attributes: sender.phone
            ? [{ name: 'phone', value: sender.phone, identity: true } as EntityAttribute]
            : [],
        },
      });
    }
  }
}

function stripTags(h: string): string {
  return h.replace(/<[^>]+>/g, '');
}

function decodeHtml(h: string): string {
  return h
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function extractSender(block: string): GVEntity {
  // Real Google Voice exports wrap the OUTBOUND sender ("Me") in
  // <abbr class="fn" title="">Me</abbr> and the INBOUND contact in
  // <span class="fn">Name</span>. The original regex only matched <span>, so
  // every outbound message landed with sender=undefined and was misclassified
  // as inbound — accept both tags.
  const nameMatch = /<(?:span|abbr) class="fn"(?:\s[^>]*)?>([^<]*)<\/(?:span|abbr)>/i.exec(block);
  const telMatch = /<a class="tel" href="tel:([^"']+)"/i.exec(block);

  return { name: nameMatch ? decodeHtml(nameMatch[1]) : undefined, phone: telMatch?.[1] };
}

// Google Voice call-log <abbr class="duration"> values have been observed in
// both a plain "H:MM:SS" / "HH:MM:SS" clock format and an ISO-8601 duration
// ("PT1M15S"). Accept either, plus a bare integer (already seconds), rather
// than assuming one specific export variant.
function parseDurationToSeconds(raw: string): number | undefined {
  const clock = /^(\d+):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (clock) {
    return +clock[1] * 3600 + +clock[2] * 60 + +clock[3];
  }

  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(raw.trim());
  if (iso && (iso[1] || iso[2] || iso[3])) {
    return +(iso[1] || 0) * 3600 + +(iso[2] || 0) * 60 + +(iso[3] || 0);
  }

  const bare = /^\d+$/.exec(raw.trim());
  if (bare) {
    return +bare[0];
  }

  return undefined;
}

function resolveAttachment(stub: string, dir: string): string | undefined {
  for (const ext of ['.jpg', '.gif', '.png', '.jpeg']) {
    const candidate = path.join(dir, stub + ext);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

// Attachment filenames embed the real send time, e.g.
// "Victoria Grant - Text - 2019-07-06T18_16_10Z-23-1.jpg" (colons swapped for
// underscores to be filename-safe). Without this, every image attachment got
// timestamp: undefined and CI-Server defaulted to ingestion time.
const TS_IN_FILENAME_RE = /(\d{4}-\d{2}-\d{2})T(\d{2})_(\d{2})_(\d{2})Z/;
function tsFromAttachmentFilename(filename: string): Date | undefined {
  const m = TS_IN_FILENAME_RE.exec(path.basename(filename));
  if (!m) {
    return undefined;
  }

  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);

  return isNaN(d.getTime()) ? undefined : d;
}

registerDataSource({
  name: 'google_voice',
  title: 'Google Voice',
  icon: 'google_voice.svg',
  description: 'Google Voice HTML conversation exports (simplified)',
  newOptions: () => ({}) as GoogleVoiceOptions,
  newFileImporter: () => new GoogleVoiceFileImporter(),
});
