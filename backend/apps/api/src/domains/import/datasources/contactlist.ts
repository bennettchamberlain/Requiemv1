/* Contact List datasource (TypeScript port) */
import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { markSharedContactHandles } from '../staging/identity';

import { parseCSVRows } from './csv';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { Entity, EntityAttribute, ImportParams } from './timeline';

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

/**
 * `Phones`, the row's numbers as typed, accumulates across sightings — see
 * `Entity.accumulate`. A contact listed twice (Google Contacts keeps duplicate
 * rows until someone merges them) stages its second row onto the first one's
 * whenever the two key on the same handle. Staging grows the normalized
 * `phones` that way on its own (`withContactIdentifiers`); without this the
 * typed list would keep only the first row's numbers.
 */
const ACCUMULATED_KEYS = ['Phones'];

/**
 * Google Contacts' CSV joins a label's several values into ONE cell —
 * `Phone 1 - Value` reads `+1 415-555-0123 ::: +1 415-555-0145` for two
 * numbers both filed as Mobile. Only ` ::: ` is split: a comma or semicolon
 * inside a phone cell is a dialling pause or an extension (`555-0147;229`),
 * and cutting there would turn one line with an extension into a line it is
 * not.
 */
const MULTI_VALUE_SEPARATOR = /\s*:::\s*/;

/**
 * Every value in a column's cells, split on {@link MULTI_VALUE_SEPARATOR}:
 * trimmed, de-duplicated in first-seen order, empties removed.
 */
function cellValues(cells: string[] | undefined): string[] {
  const values = (cells ?? [])
    .flatMap((cell) => cell.split(MULTI_VALUE_SEPARATOR))
    .map((value) => value.trim());

  return [...new Set(values.filter(Boolean))];
}

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
    if (!full) {
      return { confidence: 0 };
    }

    try {
      if ((await stat(full)).isDirectory()) {
        return { confidence: 0 };
      }
    } catch {
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

    // Emitted together after the last row: an Outlook export's "Company Main
    // Phone" column puts one switchboard on every colleague's row, and only the
    // whole file shows that — see markSharedContactHandles.
    const contacts: Entity[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length !== header.length) {
        params.pipeline.drop?.('malformed_row', `row ${i}`);
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

      // A Google/Outlook contact's Photo column is a hosted URL (contacts.google.com
      // or similar), not embedded bytes, so — unlike vcard.ts's base64 PHOTO — this
      // needs no decode/upload step: just a sanity check that it is actually an
      // http(s) URL before handing it to <img src>.
      const pictureUrl = vals[CANON.PICTURE]?.[0];
      const avatarUrl = pictureUrl && /^https?:\/\//i.test(pictureUrl) ? pictureUrl : undefined;

      // minimal usefulness filter: at least 2 attributes or one attribute + name
      if (attributes.length < 2 && !(name && attributes.length === 1)) {
        params.pipeline.drop?.('insufficient_attributes', `row ${i}`);
        continue;
      }

      // The row's numbers as typed, one entry per number. Staging indexes a
      // contact under normalized last-ten keys (`withContactIdentifiers`,
      // staging/identity.ts), and a last-ten has lost the country the typed
      // form states; the phone adjudicator (`PHONE_FACT_PROPERTY_KEYS`,
      // memory/utils/phoneIdentity.ts) and the merge union read `Phones` for
      // it, as they do the vCard parser's.
      //
      // Split on ` ::: ` here and NOT in the attributes: the key is computed
      // from the attributes, a row with a joined cell is already keyed with
      // it, and splitting there would move that key and mint a second Person
      // beside the first on the next import.
      const phones = cellValues(vals[CANON.PHONE]);

      contacts.push({
        name,
        // `type` is declared for the same reason as in vcard.ts: a contact-list row
        // is a contact even when it carries no phone or email for
        // `hasContactIdentity` to find.
        type: 'contact',
        attributes,
        metadata: {
          Source: 'ContactList',
          File: path.basename(full),
          ...(phones.length ? { Phones: phones } : {}),
          // Lowercase, unlike the other keys here: this exact key is the contract
          // `push/entities.ts` spreads straight into `ci.entities.properties`, and
          // `PersonType.avatarUrl` (backend/.../types/PersonType.ts) reads it back
          // as `properties.avatar_url`.
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        },
        accumulate: ACCUMULATED_KEYS,
      });
    }

    for (const entity of markSharedContactHandles(contacts)) {
      params.pipeline.push({ entity });
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
