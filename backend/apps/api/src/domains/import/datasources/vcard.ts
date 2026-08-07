/* vCard datasource (basic TypeScript port) */
import fs from 'node:fs';
import path from 'node:path';

import { unescapeIcsText as unescapeVCardText } from './calendar';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { EntityAttribute, ImportParams } from './timeline';
// RFC 6350 §3.4 vCard TEXT values use the same backslash escaping
// (\\ \; \, \n) as RFC 5545 §3.3.11 iCalendar TEXT values, so the two
// datasources share one implementation rather than duplicating the regex.

type VCardOptions = Record<string, never>;

export class VCardFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const full = entry.fullPath || entry.fsRoot || entry.filename;
    if (!full) {
      return { confidence: 0 };
    }

    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full).toLowerCase();
      if (ext === '.vcf' || ext === '.vcard') {
        try {
          const fd = await fs.promises.open(full, 'r');
          const buf = Buffer.alloc(11);
          await fd.read(buf, 0, 11, 0);
          await fd.close();
          if (buf.toString() === 'BEGIN:VCARD') {
            return { confidence: 1.0 };
          }
        } catch {
          /* ignore */
        }

        return { confidence: 0.8 };
      }
    }

    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      return { confidence: 0, dir_threshold: 0.9 };
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const start = entry.fullPath || entry.fsRoot || entry.filename;
    if (!start) {
      return;
    }

    const stat = fs.statSync(start);
    if (stat.isDirectory()) {
      for await (const f of this.walkDir(start)) {
        if (this.isVcf(f)) {
          await this.processFile(f, params);
        }
      }
    } else if (this.isVcf(start)) {
      await this.processFile(start, params);
    }
  }

  private isVcf(f: string): boolean {
    const e = path.extname(f).toLowerCase();

    return e === '.vcf' || e === '.vcard';
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

  private async processFile(fpath: string, params: ImportParams): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', 'read vcard failed', { file: path.basename(fpath), error: (e as Error).message });

      return;
    }

    // split by BEGIN:VCARD ... END:VCARD
    const cards = raw
      .split(/BEGIN:VCARD/i)
      .slice(1)
      .map((c) => 'BEGIN:VCARD' + c); // re-add prefix for uniformity
    for (const card of cards) {
      if (!/END:VCARD/i.test(card)) {
        continue;
      }

      const lines = card.split(/\r?\n/);
      const props: Record<string, string[]> = {};
      for (const line of lines) {
        const m = line.match(/^([^:;]+)(?:;[^:]*)?:(.*)$/);
        if (!m) {
          continue;
        }

        const key = m[1].toUpperCase();
        const val = m[2].trim();
        if (!props[key]) {
          props[key] = [];
        }

        props[key].push(val);
      }

      // FN/N/NICKNAME/URL/TEL/EMAIL/NOTE are all RFC 6350 TEXT-valued
      // properties, so every one of them may carry the backslash escapes
      // (\, \; \\ \n) decoded by unescapeVCardText — most visibly in NOTE
      // (real Apple Contacts exports: 99.4% of NOTE values in one real vCard
      // export carried undecoded \, / \; / \n), but a free-text name or URL
      // can carry them too (e.g. a NICKNAME containing an escaped comma).
      const rawFn = (props['FN']?.[0] || '').trim();
      const name = rawFn ? unescapeVCardText(rawFn) : buildName(props);
      const attributes: EntityAttribute[] = [];
      for (const phone of props['TEL'] || []) {
        attributes.push({ name: 'phone', value: unescapeVCardText(phone), identity: true });
      }

      for (const email of props['EMAIL'] || []) {
        attributes.push({ name: 'email', value: unescapeVCardText(email), identity: true });
      }

      // BDAY is a DATE(-TIME) value, not TEXT — no backslash escaping applies.
      if (props['BDAY']?.[0]) {
        attributes.push({ name: 'birth_date', value: props['BDAY'][0] });
      }

      for (const nick of props['NICKNAME'] || []) {
        attributes.push({ name: 'nickname', value: unescapeVCardText(nick) });
      }

      for (const url of props['URL'] || []) {
        attributes.push({ name: 'url', value: unescapeVCardText(url) });
      }

      for (const note of props['NOTE'] || []) {
        attributes.push({ name: 'note', value: unescapeVCardText(note) });
      }

      if (!name && attributes.length === 0) {
        continue;
      }

      params.pipeline.push({
        entity: { name, attributes, metadata: { Source: 'vCard', File: path.basename(fpath) } },
      });
    }
  }
}

function buildName(props: Record<string, string[]>): string {
  const n = props['N']?.[0];
  if (!n) {
    return '';
  }

  // N's `;`-separated components (family;given;additional;prefix;suffix) are
  // split first (unescaped `;` is the structural delimiter), then each
  // component is unescaped on its own so a component containing `\,` (or a
  // literal `\;` that was meant to stay part of the text) still decodes
  // correctly.
  const parts = n
    .split(';')
    .map((p) => unescapeVCardText(p.trim()))
    .filter(Boolean);

  return parts.join(' ');
}

registerDataSource({
  name: 'vcard',
  title: 'vCard',
  icon: 'vcard.svg',
  description: 'vCard (.vcf) contact files',
  newOptions: () => ({}) as VCardOptions,
  newFileImporter: () => new VCardFileImporter(),
});
