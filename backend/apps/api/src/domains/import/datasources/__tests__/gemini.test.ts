import fs from 'fs';
import os from 'os';
import path from 'path';

import { GeminiFileImporter } from '../gemini';
import type { Graph, ImportParams, Relationship } from '../timeline';

import type { EmittedGraph, TestPipeline } from './support/emitted';
import { metaText, metaAttachments } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Gemini datasource', () => {
  it('recognizes a Gemini MyActivity.json file', async () => {
    const fpath = path.join(FIXTURES_DIR, 'gemini-export', 'MyActivity.json');
    const fi = new GeminiFileImporter();
    const rec = await fi.recognize({}, { filename: 'MyActivity.json', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes a Gemini export directory', async () => {
    const root = path.join(FIXTURES_DIR, 'gemini-export');
    const fi = new GeminiFileImporter();
    const rec = await fi.recognize({}, { filename: 'gemini-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('does NOT recognize a non-Gemini MyActivity.json (header YouTube)', async () => {
    const fpath = path.join(FIXTURES_DIR, 'gemini-not-gemini', 'MyActivity.json');
    const fi = new GeminiFileImporter();
    const rec = await fi.recognize({}, { filename: 'MyActivity.json', fullPath: fpath });
    expect(rec.confidence).toBe(0);
  });

  it('imports Gemini prompts as message items', async () => {
    const fpath = path.join(FIXTURES_DIR, 'gemini-export', 'MyActivity.json');
    const fi = new GeminiFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'MyActivity.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(2);
    expect(pipeline.every((p) => p.item.classification === 'message')).toBe(true);
    expect(pipeline.every((p) => p.item.metadata.Source === 'Gemini')).toBe(true);
  });

  it('parses prompt metadata correctly (strips "Prompted ")', async () => {
    const fpath = path.join(FIXTURES_DIR, 'gemini-export', 'MyActivity.json');
    const fi = new GeminiFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'MyActivity.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline[0].item.metadata.Prompt).toBe('Explain quantum entanglement in simple terms');
    expect(pipeline[0].item.metadata.Direction).toBe('outgoing'); // My Activity rows are the user's own prompts
    expect(pipeline[0].item.metadata.URL).toBe('https://gemini.google.com/app/abc123');
    expect(pipeline[0].item.timestamp).toBeDefined();
    // older Bard export with bare title (no "Prompted " prefix)
    expect(pipeline[1].item.metadata.Prompt).toBe('Write a haiku about the ocean');
  });

  it('recognizes a standalone Saved Info memory file', async () => {
    const fpath = path.join(FIXTURES_DIR, 'gemini-takeout-memory', 'Gemini', 'Saved Info.json');
    const fi = new GeminiFileImporter();
    const rec = await fi.recognize({}, { filename: 'Saved Info.json', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes a Takeout Gemini folder holding only Saved Info', async () => {
    const root = path.join(FIXTURES_DIR, 'gemini-takeout-memory', 'Gemini');
    const fi = new GeminiFileImporter();
    const rec = await fi.recognize({}, { filename: 'Gemini', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('imports Saved Info entries as note items alongside activity prompts', async () => {
    const root = path.join(FIXTURES_DIR, 'gemini-takeout-memory');
    const fi = new GeminiFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'gemini-takeout-memory', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const messages = pipeline.filter((p) => p.item.classification === 'message');
    const notes = pipeline.filter((p) => p.item.classification === 'note');
    expect(messages.length).toBe(1); // MyActivity.json prompt
    expect(notes.length).toBe(2); // Saved Info: one object entry + one bare string
    expect(notes.every((p) => p.item.metadata.Source === 'Gemini')).toBe(true);
    expect(notes.every((p) => p.item.metadata.Kind === 'memory')).toBe(true);

    const veg = notes.find((p) => metaText(p.item.metadata.Text).includes('Vegetarian'));
    expect(veg!.item.id).toMatch(/^gemini:memory:[0-9a-f]{24}$/);
    expect(veg!.item.timestamp).toEqual(new Date('2026-03-15T10:00:00.000Z'));
    const bare = notes.find((p) => metaText(p.item.metadata.Text).includes('Portland'));
    expect(bare!.item.timestamp).toBeUndefined();
  });

  it('Saved Info import is idempotent (re-import yields identical ids)', async () => {
    const root = path.join(FIXTURES_DIR, 'gemini-takeout-memory');
    const fi = new GeminiFileImporter();
    const runAll = async () => {
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'gemini-takeout-memory', fullPath: root }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      return pipeline.map((p) => p.item.id!);
    };

    const ids = await runAll();
    expect(new Set(ids).size).toBe(ids.length);
    expect(await runAll()).toEqual(ids);
  });

  it('does NOT recognize a non-memory JSON as Saved Info', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-notmem-'));
    const fpath = path.join(dir, 'Saved Info.json');
    fs.writeFileSync(fpath, JSON.stringify({ someOtherShape: { nested: true } }));
    const fi = new GeminiFileImporter();
    const rec = await fi.recognize({}, { filename: 'Saved Info.json', fullPath: fpath });
    expect(rec.confidence).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('malformed input does not throw', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-bad-'));
    const fpath = path.join(dir, 'MyActivity.json');
    fs.writeFileSync(fpath, '{not valid json at all ]['); // garbage
    const fi = new GeminiFileImporter();
    const pipeline: EmittedGraph[] = [];
    await expect(fi.recognize({}, { filename: 'MyActivity.json', fullPath: fpath })).resolves.toBeDefined();
    await expect(
      fi.fileImport({}, { filename: 'MyActivity.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams),
    ).resolves.toBeUndefined();
    expect(pipeline.length).toBe(0);
  });

  it('assigns unique, idempotent ids to colliding prompts (no dedup-collapse)', async () => {
    // Records that share an identical timestamp AND constant filename ('prompt.txt'),
    // plus a time-less record, would all collapse under the old timestamp-only hash.
    const records = [
      {
        header: 'Gemini Apps',
        title: 'Prompted first prompt',
        titleUrl: 'https://gemini.google.com/app/x',
        time: '2026-05-01T10:00:00.000Z',
      },
      {
        header: 'Gemini Apps',
        title: 'Prompted second prompt',
        titleUrl: 'https://gemini.google.com/app/x',
        time: '2026-05-01T10:00:00.000Z',
      },
      { header: 'Gemini Apps', title: 'Prompted third prompt', titleUrl: 'https://gemini.google.com/app/x' }, // no time
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-dedup-'));
    const fpath = path.join(dir, 'MyActivity.json');
    fs.writeFileSync(fpath, JSON.stringify(records));
    const fi = new GeminiFileImporter();

    const run = async () => {
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'MyActivity.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      return pipeline;
    };

    const pipeline = await run();
    expect(pipeline.length).toBe(3);
    const ids = pipeline.map((p) => p.item.id!);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true); // (a) all truthy
    expect(new Set(ids).size).toBe(pipeline.length); // (b) all unique

    // (c) re-import yields identical ids (idempotent)
    const pipeline2 = await run();
    expect(pipeline2.map((p) => p.item.id!)).toEqual(ids);
  });

  it('empty input yields no items', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-empty-'));
    const fpath = path.join(dir, 'MyActivity.json');
    fs.writeFileSync(fpath, '[]');
    const fi = new GeminiFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'MyActivity.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline.length).toBe(0);
  });
});

describe('Gemini media extraction', () => {
  const MEDIA_DIR = path.join(FIXTURES_DIR, 'gemini-media-export');

  function runMedia() {
    const fi = new GeminiFileImporter();
    const pipeline: EmittedGraph[] = [];
    const drops: [string, string?][] = [];
    (pipeline as TestPipeline).drop = (reason: string, detail?: string) => drops.push([reason, detail]);

    return fi
      .fileImport({}, { filename: 'gemini-media-export', fullPath: MEDIA_DIR }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams)
      .then(() => ({ pipeline, drops }));
  }

  it('recognizes the media-export directory as a Gemini export', async () => {
    const fi = new GeminiFileImporter();
    const rec = await fi.recognize({}, { filename: 'gemini-media-export', fullPath: MEDIA_DIR });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('attaches a generated image referenced by attachedFiles to its record', async () => {
    const { pipeline } = await runMedia();
    const msg = pipeline.find((p) => p.item.metadata?.Prompt === 'Generate an image of a red fox');
    expect(msg).toBeDefined();
    // No attachment sub-item edge — that used to mint a duplicate ci.events row.
    expect(msg!.edges).toBeUndefined();
    const atts = metaAttachments(msg!.item.metadata.MediaAttachments);
    expect(atts).toHaveLength(1);
    expect(atts[0].filename).toBe('Generated_image_fox.png');
    expect(atts[0].type).toBe('image');
    expect(atts[0].mimetype).toBe('image/png');
    expect(atts[0].path.endsWith('Generated_image_fox.png')).toBe(true);
    expect(fs.readFileSync(atts[0].path).length).toBeGreaterThan(0);
  });

  it('resolves subpath references, reads bare-string entries, and ledgers missing ones', async () => {
    const { pipeline, drops } = await runMedia();
    const msg = pipeline.find((p) => p.item.metadata?.Prompt === 'Describe this picture');
    expect(msg).toBeDefined();
    const atts = metaAttachments(msg!.item.metadata.MediaAttachments);
    expect(atts).toHaveLength(1); // the on-disk upload; gone.png dropped
    expect(atts[0].path.endsWith(path.join('uploads', 'picture_of_dog.png'))).toBe(true);
    expect(drops).toContainEqual(['media_asset_missing', 'gone.png']);
  });

  it('records without attachedFiles get no attachments', async () => {
    const { pipeline } = await runMedia();
    const plain = pipeline.find((p) => p.item.metadata?.Prompt === 'Just a text question');
    expect(plain).toBeDefined();
    expect(plain!.item.metadata.MediaAttachments).toBeUndefined();
  });

  it('media import is idempotent (re-import yields identical ids)', async () => {
    const first = await runMedia();
    const again = await runMedia();
    const ids = (g: Graph) => [g.item!.id, ...(g.edges ?? []).map((e: Relationship) => e.to.item!.id)];
    expect(again.pipeline.flatMap(ids)).toEqual(first.pipeline.flatMap(ids));
  });

  it('an attachedFiles entry that path-traverses outside the export root is not resolved, even when the target exists on disk', async () => {
    // Proves the insideRoot guard in mediaForRecord is load-bearing. Inside
    // mediaForRecord, root = dirname(activityPath) = "<tmp>/My Activity/Gemini
    // Apps", so an unguarded path.join(root, '../decoy/secret.png') lands one
    // level up at "<tmp>/My Activity/decoy/secret.png" — a real file is placed
    // exactly there. The '/' in the name also rules out the bare-filename
    // recursive-search fallback resolving it another way.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-traversal-'));
    const decoyDir = path.join(tmp, 'My Activity', 'decoy');
    fs.mkdirSync(decoyDir, { recursive: true });
    fs.writeFileSync(path.join(decoyDir, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const activityDir = path.join(tmp, 'My Activity', 'Gemini Apps');
    fs.mkdirSync(activityDir, { recursive: true });
    fs.writeFileSync(
      path.join(activityDir, 'MyActivity.json'),
      JSON.stringify([
        {
          header: 'Gemini Apps',
          title: 'Prompted exfil attempt',
          titleUrl: 'https://gemini.google.com/app/traversal',
          time: '2026-05-01T10:00:00.000Z',
          attachedFiles: ['../decoy/secret.png'],
        },
      ]),
    );

    const fi = new GeminiFileImporter();
    const pipeline: EmittedGraph[] = [];
    const drops: [string, string?][] = [];
    (pipeline as TestPipeline).drop = (reason: string, detail?: string) => drops.push([reason, detail]);
    await fi.fileImport({}, { filename: path.basename(tmp), fullPath: tmp }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    // Every Gemini activity record becomes a top-level 'message' item, with
    // any resolved media riding it as a MediaAttachments descriptor (see the
    // "attaches a generated image..." test above) — never as a standalone
    // top-level media entry. Assert on the descriptor, not a top-level media
    // scan, or this test passes even if resolution silently succeeds via the
    // wrong candidate.
    const msg = pipeline.find((p) => p.item.metadata?.Prompt === 'exfil attempt');
    expect(msg).toBeDefined();
    expect(msg!.item.metadata.MediaAttachments).toBeUndefined();
    expect(pipeline.some((p) => p.item.classification === 'media')).toBe(false);
    expect(drops).toContainEqual(['media_asset_missing', '../decoy/secret.png']);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
