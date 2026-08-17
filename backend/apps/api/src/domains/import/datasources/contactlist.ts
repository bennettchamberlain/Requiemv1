/* Contact List datasource (TypeScript port) */
import fs from 'node:fs';
import path from 'node:path';

import { parseCSVRows } from './csv';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { EntityAttribute, ImportParams } from './timeline';

type ContactListOptions = Record<string, never>;

// Canonical field keys
const CANON = {
  FULL: 'full_name',
  FIRST: 'first_name',
  LAST: 'last_name',
  BIRTH: 'birthdate',
  PICTURE: 'picture',
  EMAIL: 'email',
  PHONE: 'phone',
  GENDER: 'gender',
} as const;

interface FormatDef {
  name: string;
  columns: Record<string, RegExp[]>;
}

// Mirroring Go formats (simplified)
const formats: FormatDef[] = [
  {
    name: 'Google Contacts',
    columns: {
      [CANON.FULL]: [/^name$/i],
      [CANON.BIRTH]: [/^birthday$/i],
      [CANON.PICTURE]: [/^photo$/i],
      [CANON.GENDER]: [/^gender$/i],
      [CANON.EMAIL]: [/^E-mail \d+ - Value$/i],
      [CANON.PHONE]: [/^Phone \d+ - Value$/i],
    },
  },
  {
    name: 'Outlook / Microsoft Contacts',
    columns: {
      [CANON.FIRST]: [/^first name$/i],
      [CANON.LAST]: [/^last name$/i],
      [CANON.BIRTH]: [/^birthday$/i],
      [CANON.EMAIL]: [/^e-?mail( \d+)? address$/i],
      [CANON.PHONE]: [/^(mobile|home|business|other|primary|company main) phone$/i],
    },
  },
  {
    name: 'Generic',
    columns: {
      [CANON.FULL]: [/^(name|full name)$/i],
      [CANON.FIRST]: [/^(first name|given name)$/i],
      [CANON.LAST]: [/^(last name|surname|family name|second name)$/i],
      [CANON.BIRTH]: [/^(birthday|birthdate|birth date|date of birth|dob)$/i],
      [CANON.PHONE]: [/^(phone|phone number|phone no|telephone|telephone number|telephone no)$/i],
      [CANON.EMAIL]: [/^(email|email address|electronic mail)$/i],
      [CANON.GENDER]: [/^(gender|sex)$/i],
      [CANON.PICTURE]: [/^(photo|picture|photograph|profile picture|profile photo|avatar)$/i],
    },
  },
];

function bestColumnMapping(header: string[]): Record<string, number[]> {
  let best: Record<string, number[]> = {};
  for (const fmt of formats) {
    const result: Record<string, number[]> = {};
    header.forEach((col, idx) => {
      for (const [canon, regexes] of Object.entries(fmt.columns)) {
        if (regexes.some((r) => r.test(col))) {
          (result[canon] ||= []).push(idx);
          break;
        }
      }
    });
    if (Object.keys(result).length > Object.keys(best).length) {
      best = result;
    }
  }

  return best;
}

export class ContactListFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const full = entry.fullPath || entry.fsRoot || entry.filename;
    if (!full || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return { confidence: 0 };
    }

    const ext = path.extname(full).toLowerCase();
    if (!['.csv', '.tsv', '.txt'].includes(ext)) {
      return { confidence: 0 };
    }

    // peek first lines to validate structure
    try {
      const raw = await fs.promises.readFile(full, 'utf8');
      const firstLine = raw.split(/\r?\n/)[0];
      const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
      const header = (parseCSVRows(firstLine, { delimiter: delim })[0] ?? []).map((s) => s.trim());
      if (header.length < 2) {
        return { confidence: 0 };
      }

      const mapping = bestColumnMapping(header);
      if (Object.keys(mapping).length >= 2) {
        return { confidence: 1 };
      }
    } catch {
      /* ignore */
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const full = entry.fullPath || entry.fsRoot || entry.filename;
    if (!full) {
      return;
    }

    let raw: string;
    try {
      raw = await fs.promises.readFile(full, 'utf8');
    } catch {
      return;
    }

    const firstLine = raw.split(/\r?\n/)[0] ?? '';
    const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
    const rows = parseCSVRows(raw, { delimiter: delim }).filter((r) => r.some((v) => v.trim() !== ''));
    if (rows.length === 0) {
      return;
    }

    const header = rows[0].map((s) => s.trim());
    const mapping = bestColumnMapping(header);
    if (Object.keys(mapping).length < 2) {
      return;
    } // insufficient mapping

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length !== header.length) {
        continue;
      } // skip malformed

      const vals: Record<string, string[]> = {};
      for (const [canon, idxs] of Object.entries(mapping)) {
        for (const idx of idxs) {
          const v = row[idx]?.trim();
          if (v) {
            (vals[canon] ||= []).push(v);
          }
        }
      }

      // build entity
      let name = vals[CANON.FULL]?.[0] || '';
      if (!name) {
        const first = vals[CANON.FIRST]?.[0] || '';
        const last = vals[CANON.LAST]?.[0] || '';
        name = (first + ' ' + last).trim();
      }

      const attributes: EntityAttribute[] = [];
      (vals[CANON.EMAIL] || []).forEach((v) => attributes.push({ name: 'email', value: v, identity: true }));
      (vals[CANON.PHONE] || []).forEach((v) => attributes.push({ name: 'phone', value: v, identity: true }));
      if (vals[CANON.BIRTH]?.[0]) {
        attributes.push({ name: 'birth_date', value: vals[CANON.BIRTH][0] });
      }

      if (vals[CANON.GENDER]?.[0]) {
        attributes.push({ name: 'gender', value: vals[CANON.GENDER][0] });
      }

      // minimal usefulness filter: at least 2 attributes or one attribute + name
      if (attributes.length < 2 && !(name && attributes.length === 1)) {
        continue;
      }

      params.pipeline.push({
        entity: { name, attributes, metadata: { Source: 'ContactList', File: path.basename(full) } },
      });
    }
  }
}

registerDataSource({
  name: 'contact_list',
  title: 'Contact List',
  icon: 'contact_list.svg',
  description: 'CSV/TSV contact lists (Google Contacts & generic)',
  newOptions: () => ({}) as ContactListOptions,
  newFileImporter: () => new ContactListFileImporter(),
});
