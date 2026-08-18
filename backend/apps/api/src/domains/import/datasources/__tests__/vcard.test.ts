import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import type { EntityAttribute, ImportParams } from '../timeline';
import {
  VCardFileImporter,
  buildContact,
  decodeQuotedPrintable,
  parseContentLine,
  unfoldContentLines,
  type ContentLine,
} from '../vcard';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/** Build a fresh drop-counting pipeline, matching the gmail_drops.test.ts pattern. */
function makeDropPipeline(): {
  pipeline: EmittedGraph[];
  drops: Record<string, number>;
  params: ImportParams;
} {
  const pipeline: EmittedGraph[] = [];
  const drops: Record<string, number> = {};
  const params = {
    pipeline: {
      push: (g: EmittedGraph) => pipeline.push(g),
      drop: (reason: string) => {
        drops[reason] = (drops[reason] ?? 0) + 1;
      },
    },
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams;

  return { pipeline, drops, params };
}

async function importRaw(raw: string, filename = 'card.vcf') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-vcf-'));
  const fpath = path.join(dir, filename);
  fs.writeFileSync(fpath, raw);
  const { pipeline, drops, params } = makeDropPipeline();
  try {
    await new VCardFileImporter().fileImport({}, { filename, fullPath: fpath }, params);

    return { pipeline, drops };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Parse a fixture's unfolded lines into ContentLine[], skipping BEGIN/END/blank. */
function contentLines(raw: string): ContentLine[] {
  const out: ContentLine[] = [];
  for (const line of unfoldContentLines(raw)) {
    const trimmed = line.trim();
    if (!trimmed || /^(BEGIN|END):VCARD$/i.test(trimmed)) {
      continue;
    }

    const parsed = parseContentLine(line);
    if (parsed) {
      out.push(parsed);
    }
  }

  return out;
}

/**
 * A contact is emitted as an ITEM carrying a `contact` edge to its entity, not
 * as a bare entity. That is the shape the upstream rewrite settled on and it is
 * load-bearing: the item is what gives a card a stable id to dedup a re-import
 * against, and the edge is what lets a contact resolve to a person. The old
 * entity-only emission is precisely what made 5,250 contacts import as zero
 * items.
 */
function contactEntities(emitted: EmittedGraph[]) {
  return emitted.flatMap((graph) =>
    (graph.edges ?? [])
      .filter((edge) => edge.relation === 'contact')
      .map((edge) => edge.to?.entity)
      .filter(Boolean),
  );
}

describe('vCard datasource', () => {
  it('recognizes .vcf file', async () => {
    const vcfPath = path.join(FIXTURES_DIR, 'sample.vcf');
    const fi = new VCardFileImporter();
    const rec = await fi.recognize({}, { filename: 'sample.vcf', fullPath: vcfPath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('imports vCard contacts', async () => {
    const vcfPath = path.join(FIXTURES_DIR, 'sample.vcf');
    const fi = new VCardFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'sample.vcf', fullPath: vcfPath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const entities = contactEntities(pipeline);
    expect(entities.length).toBe(2);
    expect(entities[0]!.name).toBe('John Doe');
    expect(entities[0]!.metadata?.Source).toBe('vCard');
    expect(entities[0]!.attributes).toBeDefined();

    // Every card is now an item too — the half that was missing before.
    expect(pipeline.filter((p) => p.item).length).toBe(2);
  });

  it('unescapes RFC 6350 TEXT backslash sequences in NOTE (and other TEXT fields)', async () => {
    // Real Apple Contacts export: 2271/2285 (99.4%) of NOTE attributes
    // carried literal \, / \; / \n sequences that were never decoded to
    // real punctuation/newlines before being stored.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-vcf-unescape-'));
    const vcfPath = path.join(dir, 'escaped.vcf');
    fs.writeFileSync(
      vcfPath,
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Jane\\, Q. Public',
        'N:Public;Jane;Q.;;',
        'TEL;TYPE=HOME:+1-555-123-4567',
        'EMAIL;TYPE=INTERNET:jane@example.com',
        'NICKNAME:J.Q.\\; The Second',
        'NOTE:Met at conf\\, Chicago\\; follow up\\nSent contract\\\\draft',
        'END:VCARD',
      ].join('\r\n'),
    );
    try {
      const fi = new VCardFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'escaped.vcf', fullPath: vcfPath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);
      const [entity] = contactEntities(pipeline);
      expect(entity!.name).toBe('Jane, Q. Public');
      const nickname = entity!.attributes!.find((a: EntityAttribute) => a.name === 'nickname');
      expect(nickname!.value).toBe('J.Q.; The Second');
      const note = entity!.attributes!.find((a: EntityAttribute) => a.name === 'note');
      expect(note!.value).toBe('Met at conf, Chicago; follow up\nSent contract\\draft');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Attribute shape with the vCard-specific `label`/`pref` extras that ride
 * alongside the base `EntityAttribute` (see ContactAttribute in ../vcard).
 * Not exported from the production module, so mirrored here for assertions.
 */
interface LabelledAttribute extends EntityAttribute {
  label?: string;
  pref?: boolean;
}

describe('unfoldContentLines (RFC 6350 §3.2 unfolding)', () => {
  it('reconstructs the original content byte-for-byte across a standard CRLF+SPACE fold', () => {
    // Fold at an arbitrary interior position: real exporters wrap at a byte
    // count, not a word boundary, mid-word included.
    const original =
      'NOTE:Line one of a very long note that must be fold' +
      'ed across the wire to stay under a line-length limit.';
    const at = original.indexOf('fold') + 'fold'.length; // mid-word, right after "fold"
    const folded = original.slice(0, at) + '\r\n ' + original.slice(at);

    expect(unfoldContentLines(folded)).toEqual([original]);
  });

  it('does not lose the fold when it lands on an existing word boundary', () => {
    const original = 'NOTE:first segment second segment third segment';
    const at = original.indexOf(' second'); // fold right before a real space
    const folded = original.slice(0, at) + '\r\n ' + original.slice(at);

    expect(unfoldContentLines(folded)).toEqual([original]);
  });

  it('joins a vCard 2.1 QUOTED-PRINTABLE soft break (trailing "=", no leading whitespace)', () => {
    const raw = ['NOTE;ENCODING=QUOTED-PRINTABLE:one=', 'two'].join('\r\n');
    expect(unfoldContentLines(raw)).toEqual(['NOTE;ENCODING=QUOTED-PRINTABLE:onetwo']);
  });

  it('does not treat a trailing "=" as a QP soft break unless ENCODING=QUOTED-PRINTABLE is present', () => {
    // A URL that happens to end in an unrelated "=" (e.g. a query string) must
    // not swallow the next, unrelated property line.
    const raw = ['URL:https://example.com/x=', 'TEL:+15551234567'].join('\r\n');
    expect(unfoldContentLines(raw)).toEqual(['URL:https://example.com/x=', 'TEL:+15551234567']);
  });

  it('discards rather than joins the folded continuation of a binary (base64) property', () => {
    // PHOTO is most of an Apple export's bytes; a folded continuation must be
    // dropped, never appended, or a large address book is held twice in memory.
    const raw = ['PHOTO;ENCODING=b;TYPE=JPEG:AAAA', ' BBBB', ' CCCC', 'FN:Next Person'].join('\r\n');
    const lines = unfoldContentLines(raw);
    expect(lines).toEqual(['PHOTO;ENCODING=b;TYPE=JPEG:AAAA', 'FN:Next Person']);
    expect(lines.join('')).not.toContain('BBBB');
  });
});

describe('parseContentLine (grouped [group.]NAME[;params]:value tokenizer)', () => {
  it('splits an itemN. property group from the property name', () => {
    const parsed = parseContentLine('item1.EMAIL;type=INTERNET:someone@example.com');
    expect(parsed).toEqual({
      group: 'ITEM1',
      name: 'EMAIL',
      params: { TYPE: ['INTERNET'] },
      value: 'someone@example.com',
      binary: false,
    });
  });

  it('rejects a fold-leftover text fragment instead of treating it as a bogus property', () => {
    // This is the exact old-regex failure: a NOTE's folded continuation that
    // never got joined ("Connected On: 09 May 2014") was accepted as its own
    // property because the old regex didn't validate the name token.
    expect(parseContentLine('Connected On: 09 May 2014')).toBeNull();
  });

  it('ignores a parameter-value separator inside double quotes', () => {
    const parsed = parseContentLine('NOTE;X-INFO="a;b":Hello');
    expect(parsed?.params['X-INFO']).toEqual(['a;b']);
    expect(parsed?.value).toBe('Hello');
  });

  it('returns null for a line with no unquoted colon', () => {
    expect(parseContentLine('not a content line at all')).toBeNull();
  });
});

describe('grouped X-ABLabel resolution (labelFor, exercised via buildContact)', () => {
  it('attaches the group label whether X-ABLabel appears before or after the labelled property', () => {
    const raw = [
      'FN:Test Person',
      // item1: label AFTER the property it describes.
      'item1.EMAIL;type=INTERNET:school@example.com',
      'item1.X-ABLabel:_$!<School>!$_',
      // item2: label BEFORE the property it describes.
      'item2.X-ABLabel:_$!<Assistant>!$_',
      'item2.TEL;type=CELL:+15550001111',
      // Ungrouped property: no label to inherit.
      'EMAIL;type=INTERNET:plain@example.com',
    ].join('\r\n');

    const built = buildContact(contentLines(raw), 'labels.vcf');
    expect(built).not.toBeNull();
    const attrs = (built!.entity.attributes ?? []) as LabelledAttribute[];

    const schoolEmail = attrs.find((a) => a.name === 'email' && a.value === 'school@example.com');
    expect(schoolEmail?.label).toBe('School');

    const assistantPhone = attrs.find((a) => a.name === 'phone' && a.value === '+15550001111');
    expect(assistantPhone?.label).toBe('Assistant');

    // Ungrouped EMAIL;type=INTERNET must not fall back to "INTERNET" as a
    // label — INTERNET is a transport marker, not a human label.
    const plainEmail = attrs.find((a) => a.name === 'email' && a.value === 'plain@example.com');
    expect(plainEmail?.label).toBeUndefined();
  });
});

describe('decodeQuotedPrintable (RFC 2045 §6.7 + CHARSET)', () => {
  it('decodes a single-byte CHARSET (ISO-8859-1) hex escape to the right character', () => {
    expect(decodeQuotedPrintable('caf=E9', 'iso-8859-1')).toBe('café');
  });

  it('decodes a UTF-8 multi-byte hex escape', () => {
    expect(decodeQuotedPrintable('caf=C3=A9', 'utf-8')).toBe('café');
  });

  it('falls back to utf-8 for an unrecognized charset name rather than throwing', () => {
    expect(decodeQuotedPrintable('caf=C3=A9', 'x-mystery-charset')).toBe('café');
  });

  it('decodes CHARSET/QUOTED-PRINTABLE end-to-end through parseContentLine', () => {
    const parsed = parseContentLine('NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=ISO-8859-1:caf=E9 au coin');
    expect(parsed?.binary).toBe(false);
    expect(parsed?.value).toBe('café au coin');
  });

  it('marks an ENCODING=b/BASE64 value binary and empty, never retaining the blob', () => {
    const parsed = parseContentLine('PHOTO;ENCODING=b;TYPE=JPEG:AAAABBBBCCCC==');
    expect(parsed?.binary).toBe(true);
    expect(parsed?.value).toBe('');
  });
});

describe('contactId (UID-vs-hash dedup stability)', () => {
  const line = (s: string) => parseContentLine(s)!;

  it('is idempotent for the same content on re-import (no UID)', () => {
    const lines = [line('FN:Bob NoUid'), line('TEL:+15551110000')];
    const first = buildContact(lines, 'contacts.vcf')!;
    const second = buildContact(lines, 'contacts.vcf')!;
    expect(first.item.id).toBe(second.item.id);
  });

  it('changes id when card content changes and there is no UID', () => {
    const v1 = buildContact([line('FN:Bob NoUid'), line('TEL:+15551110000')], 'contacts.vcf')!;
    const v2 = buildContact([line('FN:Bob NoUid'), line('TEL:+15559998888')], 'contacts.vcf')!;
    expect(v1.item.id).not.toBe(v2.item.id);
  });

  it('keeps the id stable across a content edit when the card carries a UID', () => {
    // A card with a UID identifies itself by UID+file, not by content — so
    // editing a field between two exports of the same file still dedups to
    // one row instead of filing a duplicate contact.
    const v1 = buildContact(
      [line('FN:Alice'), line('UID:abc-123'), line('TEL:+15551110000')],
      'contacts.vcf',
    )!;
    const v2 = buildContact(
      [line('FN:Alice'), line('UID:abc-123'), line('TEL:+15559998888')],
      'contacts.vcf',
    )!;
    expect(v1.item.id).toBe(v2.item.id);
  });

  it('still separates the same UID seen in two different export files', () => {
    // Google Takeout's per-label exports legitimately repeat one person's UID
    // across several files as several distinct cards.
    const inFileA = buildContact([line('FN:Alice'), line('UID:abc-123')], 'contacts-a.vcf')!;
    const inFileB = buildContact([line('FN:Alice'), line('UID:abc-123')], 'contacts-b.vcf')!;
    expect(inFileA.item.id).not.toBe(inFileB.item.id);
  });
});

describe('drop ledger accounting', () => {
  it('drops a card truncated at end-of-file with no END:VCARD', async () => {
    const { pipeline, drops } = await importRaw('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Truncated Person\r\n');
    expect(drops).toEqual({ no_end_marker: 1 });
    expect(pipeline.length).toBe(0);
  });

  it('drops a card truncated by a second BEGIN:VCARD, then imports the one that follows', async () => {
    const raw = ['BEGIN:VCARD', 'FN:First (truncated)', 'BEGIN:VCARD', 'FN:Second', 'END:VCARD', ''].join(
      '\r\n',
    );
    const { pipeline, drops } = await importRaw(raw);
    expect(drops).toEqual({ no_end_marker: 1 });
    const entities = contactEntities(pipeline);
    expect(entities.length).toBe(1);
    expect(entities[0]!.name).toBe('Second');
  });

  it('drops a card with neither a name nor any usable attribute', async () => {
    const raw = ['BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Test//EN', 'END:VCARD', ''].join('\r\n');
    const { pipeline, drops } = await importRaw(raw);
    expect(drops).toEqual({ empty_card: 1 });
    expect(pipeline.length).toBe(0);
  });

  it('drops a file it cannot read and records the reason, instead of throwing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-vcf-unreadable-'));
    const fpath = path.join(dir, 'broken.vcf');
    fs.writeFileSync(fpath, 'BEGIN:VCARD\r\nFN:Doesnt Matter\r\nEND:VCARD\r\n');
    const spy = jest
      .spyOn(fs.promises, 'readFile')
      .mockRejectedValueOnce(new Error('EACCES: permission denied'));
    const { pipeline, drops, params } = makeDropPipeline();
    try {
      await new VCardFileImporter().fileImport({}, { filename: 'broken.vcf', fullPath: fpath }, params);
      expect(drops).toEqual({ unreadable_file: 1 });
      expect(pipeline.length).toBe(0);
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('full pipeline: grouped labels + folded NOTE + QUOTED-PRINTABLE ORG together', () => {
  it('imports a realistic Apple-style card intact end to end', async () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Dupont;Marie;;;',
      'FN:Marie Dupont',
      'item1.EMAIL;type=INTERNET:marie@example.com',
      'item1.X-ABLabel:_$!<School>!$_',
      'item2.URL;type=pref:https://example.com/marie',
      'item2.X-ABLabel:_$!<Homepage>!$_',
      'ORG;ENCODING=QUOTED-PRINTABLE;CHARSET=ISO-8859-1:Caf=E9 Cr=E9atif',
      'NOTE:Line one of a very long note that must be fold',
      ' ed across the wire to stay under a line-length limit.',
      'END:VCARD',
      '',
    ].join('\r\n');

    const { pipeline, drops } = await importRaw(raw, 'marie.vcf');

    expect(drops).toEqual({});
    const entities = contactEntities(pipeline);
    expect(entities.length).toBe(1);
    const [entity] = entities;
    expect(entity!.name).toBe('Marie Dupont');

    const attrs = (entity!.attributes ?? []) as LabelledAttribute[];
    const email = attrs.find((a) => a.name === 'email');
    expect(email?.value).toBe('marie@example.com');
    expect(email?.label).toBe('School'); // not "ITEM1.EMAIL" and not lost

    const url = attrs.find((a) => a.name === 'url');
    expect(url?.value).toBe('https://example.com/marie');
    expect(url?.label).toBe('Homepage');

    const org = attrs.find((a) => a.name === 'organization');
    expect(org?.value).toBe('Café Créatif'); // QUOTED-PRINTABLE/ISO-8859-1 decoded

    const note = attrs.find((a) => a.name === 'note');
    expect(note?.value).toBe(
      'Line one of a very long note that must be folded across the wire to stay under a line-length limit.',
    );
  });
});
