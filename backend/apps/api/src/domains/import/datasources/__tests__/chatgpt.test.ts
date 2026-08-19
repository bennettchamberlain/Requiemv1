import fs from 'fs';
import os from 'os';
import path from 'path';

import { ChatGPTFileImporter } from '../chatgpt';
import { ClaudeFileImporter } from '../claude';
import type { Graph, ImportParams, Relationship } from '../timeline';

import type { EmittedGraph, TestPipeline } from './support/emitted';
import { metaText, metaAttachments } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CHATGPT_DIR = path.join(FIXTURES_DIR, 'chatgpt-export');
const CHATGPT_FILE = path.join(CHATGPT_DIR, 'conversations.json');
const CLAUDE_DIR = path.join(FIXTURES_DIR, 'claude-export');

function run(entry: { filename: string; fullPath: string }) {
  const fi = new ChatGPTFileImporter();
  const pipeline: EmittedGraph[] = [];

  return fi
    .fileImport({}, entry, { pipeline, timeframe: {}, log: () => {} } as unknown as ImportParams)
    .then(() => pipeline);
}

describe('ChatGPT datasource', () => {
  it('recognizes the conversations.json file', async () => {
    const fi = new ChatGPTFileImporter();
    const rec = await fi.recognize({}, { filename: 'conversations.json', fullPath: CHATGPT_FILE });
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('recognizes a directory containing conversations.json', async () => {
    const fi = new ChatGPTFileImporter();
    const rec = await fi.recognize({}, { filename: 'chatgpt-export', fullPath: CHATGPT_DIR });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('imports user and assistant messages as message items', async () => {
    const pipeline = await run({ filename: 'chatgpt-export', fullPath: CHATGPT_DIR });
    const messages = pipeline.filter((p) => p.item.classification === 'message');
    // conv-1: user, assistant, user (system part is empty → skipped) = 3
    // conv-2: user, assistant = 2
    expect(messages.length).toBe(5);
  });

  it('imports saved memories from a sibling memories.json as note items', async () => {
    const pipeline = await run({ filename: 'chatgpt-export', fullPath: CHATGPT_DIR });
    const notes = pipeline.filter((p) => p.item.classification === 'note');
    // memories.json: two object entries + one bare-string entry
    expect(notes.length).toBe(3);
    expect(notes.every((p) => p.item.metadata.Source === 'ChatGPT')).toBe(true);
    expect(notes.every((p) => p.item.metadata.Kind === 'memory')).toBe(true);

    const named = notes.find((p) => metaText(p.item.metadata.Text).includes('Portland'));
    expect(named!.item.id).toBe('chatgpt:memory:mem-001'); // vendor id → stable item id
    expect(named!.item.timestamp).toEqual(new Date(1740787200 * 1000)); // epoch seconds
    expect(named!.item.metadata.Updated).toEqual(new Date(1741392000 * 1000));

    const pref = notes.find((p) => p.item.id === 'chatgpt:memory:mem-002');
    expect(pref!.item.metadata.Category).toBe('preferences');

    // bare-string entry: no vendor id → content-hash id, no timestamp
    const bare = notes.find((p) => metaText(p.item.metadata.Text).includes('hiking'));
    expect(bare!.item.id).toMatch(/^chatgpt:memory:[0-9a-f]{24}$/);
    expect(bare!.item.timestamp).toBeUndefined();
  });

  it('recognizes a memory-only export directory (no conversations.json)', async () => {
    const dir = path.join(FIXTURES_DIR, 'chatgpt-memory-export');
    const fi = new ChatGPTFileImporter();
    const rec = await fi.recognize({}, { filename: 'chatgpt-memory-export', fullPath: dir });
    expect(rec.confidence).toBeGreaterThan(0.8);

    const pipeline = await run({ filename: 'chatgpt-memory-export', fullPath: dir });
    expect(pipeline.length).toBe(2);
    expect(pipeline.every((p) => p.item.classification === 'note')).toBe(true);
  });

  it('recognizes a standalone ChatGPT-shaped memories.json file', async () => {
    const fi = new ChatGPTFileImporter();
    const rec = await fi.recognize(
      {},
      {
        filename: 'memories.json',
        fullPath: path.join(CHATGPT_DIR, 'memories.json'),
      },
    );
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('does NOT recognize a Claude-shaped memories.json (uuid/ISO timestamps)', async () => {
    const fi = new ChatGPTFileImporter();
    const recFile = await fi.recognize(
      {},
      {
        filename: 'memories.json',
        fullPath: path.join(CLAUDE_DIR, 'memories.json'),
      },
    );
    expect(recFile.confidence).toBe(0);
    const recDir = await fi.recognize(
      {},
      {
        filename: 'claude-memory-export',
        fullPath: path.join(FIXTURES_DIR, 'claude-memory-export'),
      },
    );
    expect(recDir.confidence).toBe(0);
  });

  it('memory import is idempotent (re-import yields identical ids)', async () => {
    const first = await run({ filename: 'chatgpt-export', fullPath: CHATGPT_DIR });
    const again = await run({ filename: 'chatgpt-export', fullPath: CHATGPT_DIR });
    expect(again.map((p) => p.item.id!)).toEqual(first.map((p) => p.item.id!));
    expect(new Set(first.map((p) => p.item.id!)).size).toBe(first.length);
  });

  it('timeframe filters dated memories but keeps undated ones', async () => {
    const fi = new ChatGPTFileImporter();
    const pipeline: EmittedGraph[] = [];
    // Both object memories are created in Mar 2025; the bare-string memory has
    // no timestamp and must survive any timeframe (zero-value semantics).
    await fi.fileImport(
      {},
      { filename: 'memories.json', fullPath: path.join(CHATGPT_DIR, 'memories.json') },
      {
        pipeline,
        timeframe: { until: new Date('2024-01-01T00:00:00Z') },
        log: () => {},
      } as unknown as ImportParams,
    );
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.timestamp).toBeUndefined();
  });

  it('malformed memories.json does not throw and yields no items', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-badmem-'));
    const fpath = path.join(dir, 'memories.json');
    fs.writeFileSync(fpath, '{ "memories": [ oops');
    const fi = new ChatGPTFileImporter();
    await expect(fi.recognize({}, { filename: 'memories.json', fullPath: fpath })).resolves.toBeDefined();
    const pipeline = await run({ filename: 'memories.json', fullPath: fpath });
    expect(pipeline.length).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sets Role, Source, and Conversation metadata', async () => {
    const pipeline = await run({ filename: 'conversations.json', fullPath: CHATGPT_FILE });
    expect(pipeline[0].item.metadata.Role).toBe('user');
    expect(pipeline[0].item.metadata.Source).toBe('ChatGPT');
    expect(pipeline[0].item.metadata.Conversation).toBe('Planning a trip');
    expect(pipeline[1].item.metadata.Role).toBe('assistant');
    expect(pipeline[0].item.timestamp).toBeInstanceOf(Date);
  });

  it('sets From/To/Direction/ThreadId so communications resolve participants', async () => {
    const pipeline = await run({ filename: 'conversations.json', fullPath: CHATGPT_FILE });
    // outbound: a user turn — From = 'You', To = 'ChatGPT'
    expect(pipeline[0].item.metadata.From).toBe('You');
    expect(pipeline[0].item.metadata.To).toBe('ChatGPT');
    expect(pipeline[0].item.metadata.Direction).toBe('outgoing');
    expect(pipeline[0].item.metadata.ThreadId).toBe('conv-1');
    // inbound: an assistant turn — From = 'ChatGPT', To = 'You'
    expect(pipeline[1].item.metadata.From).toBe('ChatGPT');
    expect(pipeline[1].item.metadata.To).toBe('You');
    expect(pipeline[1].item.metadata.Direction).toBe('incoming');
    expect(pipeline[1].item.metadata.ThreadId).toBe('conv-1');
    // conversation_id fallback (conv-2 uses conversation_id, not id)
    const conv2 = pipeline.find((p: EmittedGraph) => p.item.metadata.Conversation === 'Debugging code');
    expect(conv2!.item.metadata.ThreadId).toBe('conv-2');
  });

  it('does NOT recognize the Claude fixture (disambiguation)', async () => {
    const fi = new ChatGPTFileImporter();
    const recFile = await fi.recognize(
      {},
      {
        filename: 'conversations.json',
        fullPath: path.join(CLAUDE_DIR, 'conversations.json'),
      },
    );
    expect(recFile.confidence).toBe(0);
    const recDir = await fi.recognize({}, { filename: 'claude-export', fullPath: CLAUDE_DIR });
    expect(recDir.confidence).toBe(0);
  });

  it('and ClaudeFileImporter does NOT recognize the ChatGPT fixture', async () => {
    const fi = new ClaudeFileImporter();
    const recFile = await fi.recognize({}, { filename: 'conversations.json', fullPath: CHATGPT_FILE });
    expect(recFile.confidence).toBe(0);
    const recDir = await fi.recognize({}, { filename: 'chatgpt-export', fullPath: CHATGPT_DIR });
    expect(recDir.confidence).toBe(0);
  });

  it('malformed input does not throw', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-bad-'));
    const fpath = path.join(dir, 'conversations.json');
    fs.writeFileSync(fpath, '{ this is not json [[[\x00\xff');
    const fi = new ChatGPTFileImporter();
    await expect(
      fi.recognize({}, { filename: 'conversations.json', fullPath: fpath }),
    ).resolves.toBeDefined();
    const pipeline = await run({ filename: 'conversations.json', fullPath: fpath });
    expect(pipeline.length).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('assigns stable unique ids so same-timestamp messages do not collapse', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-dedup-'));
    const fpath = path.join(dir, 'conversations.json');
    // Two messages in the same conversation sharing the identical create_time
    // would collapse under the old timestamp-only dedup hash (constant filename).
    const convs = [
      {
        id: 'conv-x',
        title: 'Same second',
        create_time: 1704067200,
        mapping: {
          n1: {
            id: 'n1',
            message: {
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['first message'] },
              create_time: 1704067200,
            },
          },
          n2: {
            id: 'n2',
            message: {
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['second message'] },
              create_time: 1704067200,
            },
          },
        },
      },
    ];
    fs.writeFileSync(fpath, JSON.stringify(convs));

    const pipeline = await run({ filename: 'conversations.json', fullPath: fpath });
    expect(pipeline.length).toBe(2);
    const ids = pipeline.map((p) => p.item.id!);
    expect(ids.every((id) => !!id)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    // Re-import yields identical ids (idempotent).
    const pipeline2 = await run({ filename: 'conversations.json', fullPath: fpath });
    expect(pipeline2.map((p) => p.item.id!)).toEqual(ids);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('empty input yields no items', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-empty-'));
    const fpath = path.join(dir, 'conversations.json');
    fs.writeFileSync(fpath, '[]');
    const pipeline = await run({ filename: 'conversations.json', fullPath: fpath });
    expect(pipeline.length).toBe(0);
    // an empty array is not a recognized ChatGPT export
    const fi = new ChatGPTFileImporter();
    const rec = await fi.recognize({}, { filename: 'conversations.json', fullPath: fpath });
    expect(rec.confidence).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('ChatGPT media extraction', () => {
  const MEDIA_DIR = path.join(FIXTURES_DIR, 'chatgpt-media-export');

  function runMedia() {
    const fi = new ChatGPTFileImporter();
    const pipeline: EmittedGraph[] = [];
    const drops: [string, string?][] = [];
    (pipeline as TestPipeline).drop = (reason: string, detail?: string) => drops.push([reason, detail]);

    return fi
      .fileImport({}, { filename: 'chatgpt-media-export', fullPath: MEDIA_DIR }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams)
      .then(() => ({ pipeline, drops }));
  }

  it('attaches an uploaded image to its message as a MediaAttachments descriptor', async () => {
    const { pipeline } = await runMedia();
    const msg = pipeline.find((p) => p.item.id === 'chatgpt:conv-m1:n0');
    expect(msg).toBeDefined();
    // No attachment sub-item edge — that used to mint a duplicate ci.events row.
    expect(msg!.edges).toBeUndefined();
    const atts = metaAttachments(msg!.item.metadata.MediaAttachments);
    expect(atts).toHaveLength(1);
    expect(atts[0].filename).toBe('file-UPLOAD42-sketch.png');
    expect(atts[0].type).toBe('image');
    expect(atts[0].mimetype).toBe('image/png');
    expect(atts[0].path.endsWith('file-UPLOAD42-sketch.png')).toBe(true);
    expect(fs.readFileSync(atts[0].path).length).toBeGreaterThan(0);
  });

  it('imports a DALL-E generation (tool node) as a standalone media item', async () => {
    const { pipeline } = await runMedia();
    const gen = pipeline.find((p) => p.item.id === 'chatgpt:media:dalle-generations/file_GENABC123-gen.webp');
    expect(gen).toBeDefined();
    expect(gen!.edges).toBeUndefined();
    expect(gen!.item.classification).toBe('media');
    expect(gen!.item.content.mediaType).toBe('image/webp');
    expect(gen!.item.metadata.Prompt).toBe('A minimalist fox logo');
    expect(gen!.item.timestamp).toEqual(new Date(1720000120 * 1000));
    // tool nodes contribute media only — no message item for n1
    expect(pipeline.find((p) => p.item.id === 'chatgpt:conv-m1:n1')).toBeUndefined();
  });

  it('ledgers a pointer with no file on disk and keeps the message', async () => {
    const { pipeline, drops } = await runMedia();
    expect(drops).toContainEqual(['media_asset_missing', 'file-service://file-MISSING99']);
    const msg = pipeline.find((p) => p.item.id === 'chatgpt:conv-m1:n3');
    expect(msg).toBeDefined();
    expect(msg!.edges).toBeUndefined();
  });

  it('media import is idempotent (re-import yields identical ids)', async () => {
    const first = await runMedia();
    const again = await runMedia();
    const ids = (g: Graph) => [g.item!.id, ...(g.edges ?? []).map((e: Relationship) => e.to.item!.id)];
    expect(again.pipeline.flatMap(ids)).toEqual(first.pipeline.flatMap(ids));
  });

  it('a text-only export emits no media items and no drops', async () => {
    const fi = new ChatGPTFileImporter();
    const pipeline: EmittedGraph[] = [];
    const drops: unknown[] = [];
    (pipeline as TestPipeline).drop = (...d: unknown[]) => drops.push(d);
    await fi.fileImport({}, { filename: 'chatgpt-export', fullPath: CHATGPT_DIR }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline.some((p) => p.item.classification === 'media')).toBe(false);
    expect(drops).toEqual([]);
  });
});
