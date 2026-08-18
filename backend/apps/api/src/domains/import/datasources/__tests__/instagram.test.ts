import fs from 'fs';
import os from 'os';
import path from 'path';

import { InstagramFileImporter } from '../instagram';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Instagram datasource', () => {
  it('recognizes directory with your_instagram_activity folder', async () => {
    const root = path.join(FIXTURES_DIR, 'instagram-export');
    const fi = new InstagramFileImporter();
    const rec = await fi.recognize({}, { filename: 'instagram-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('imports messages and posts', async () => {
    const root = path.join(FIXTURES_DIR, 'instagram-export');
    const fi = new InstagramFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'instagram-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    // 3 messages + 2 posts
    expect(pipeline.length).toBe(5);
  });

  it('imports messages with correct classification', async () => {
    const root = path.join(FIXTURES_DIR, 'instagram-export');
    const fi = new InstagramFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'instagram-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const messages = pipeline.filter((p) => p.item.classification === 'message');
    expect(messages.length).toBe(3);
    expect(messages[0].item.metadata.Sender).toBe('alice');
    expect(messages[0].item.metadata.Source).toBe('Instagram');
    expect(messages[0].item.timestamp).toBeDefined();
    // Participants + direction: roster is [alice, testuser], thread titled 'alice'
    // so owner = testuser. Inbound msg from alice -> To=testuser, From Me=false.
    expect(messages[0].item.metadata.To).toBe('testuser');
    expect(messages[0].item.metadata['From Me']).toBe(false);
    // Outbound msg from testuser (owner) -> To=alice, From Me=true.
    const mine = messages.find((m) => m.item.metadata.Sender === 'testuser');
    expect(mine!.item.metadata.To).toBe('alice');
    expect(mine!.item.metadata['From Me']).toBe(true);
  });

  it('imports posts with correct classification', async () => {
    const root = path.join(FIXTURES_DIR, 'instagram-export');
    const fi = new InstagramFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'instagram-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const posts = pipeline.filter((p) => p.item.classification === 'social');
    expect(posts.length).toBe(2);
    expect(posts[0].item.metadata.Source).toBe('Instagram');
    // Caption rides under title- and body-bearing keys so titleFor/descriptionFor
    // resolve the caption instead of falling back to basename('post.txt').
    expect(posts[0].item.metadata.Title).toBe('Beautiful sunset at the beach 🌅');
    expect(posts[0].item.metadata.Text).toBe('Beautiful sunset at the beach 🌅');
    expect(posts[0].item.metadata.Title).not.toBe('post.txt');
  });
});

describe('Instagram datasource — Meta HTML format', () => {
  const root = path.join(FIXTURES_DIR, 'instagram-html-export');

  async function runImport() {
    const fi = new InstagramFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'instagram-html-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    return pipeline;
  }

  it('recognizes the HTML export (your_instagram_activity present)', async () => {
    const fi = new InstagramFileImporter();
    const rec = await fi.recognize({}, { filename: 'instagram-html-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('imports DMs from message_*.html with sender, conversation and timestamp', async () => {
    const pipeline = await runImport();
    const messages = pipeline.filter((p) => p.item.classification === 'message');
    expect(messages.length).toBe(2);

    const alice = messages.find((m) => m.item.metadata.Sender === 'Alice Example');
    expect(alice).toBeDefined();
    expect(alice!.item.metadata.Conversation).toBe('Alice Example');
    expect(alice!.item.metadata.Source).toBe('Instagram');
    expect(alice!.item.timestamp).toBeInstanceOf(Date);
    const text = (await alice!.item.content.data!()).toString();
    // Entity decoded; sender line dropped from body.
    expect(text).toContain('Hey there & welcome!');
    expect(text).not.toContain('Alice Example');

    // Best-effort recipient: a message from someone other than the conversation
    // title (Bob) gets To=<conversation>; the title's own message leaves To unset.
    const bob = messages.find((m) => m.item.metadata.Sender === 'Bob');
    expect(bob!.item.metadata.To).toBe('Alice Example');
    expect(alice!.item.metadata.To).toBeUndefined();
  });

  it('imports likes from liked_posts.html as classification "like"', async () => {
    const pipeline = await runImport();
    const likes = pipeline.filter((p) => p.item.classification === 'like');
    expect(likes.length).toBe(2);
    expect(likes[0].item.metadata.Source).toBe('Instagram');
    expect(likes[0].item.timestamp).toBeInstanceOf(Date);
    const text = (await likes[0].item.content!.data!()).toString();
    expect(text).toContain('A great post about AI & privacy');
  });

  it('titles every activity entry with its human label, not the raw export filename', () => {
    // Every entry from processHtmlActivity used to have no Title at all, so the
    // canonical mapper fell back to content.filename — "liked_posts.html",
    // "stories_viewed.html" — verbatim, on the timeline, repeated once per
    // entry. Verified on a real import: all 39 Instagram events, every one.
    return runImport().then((pipeline) => {
      const likes = pipeline.filter((p) => p.item.classification === 'like');

      expect(likes[0].item.metadata.Title).toBe('Instagram like');
      expect(likes[0].item.metadata.Title).not.toMatch(/\.html$/);
      // The entry's own detail (caption/URL) still rides along, now as
      // Description rather than being the only place it appeared.
      expect(likes[0].item.metadata.Description).toContain('A great post about AI & privacy');
    });
  });

  it('imports saved items as classification "interaction"', async () => {
    const pipeline = await runImport();
    const saved = pipeline.filter(
      (p) => p.item.classification === 'interaction' && p.item.metadata.Type === 'Instagram saved',
    );
    expect(saved.length).toBe(1);
    expect(saved[0].item.timestamp).toBeInstanceOf(Date);
  });

  it('imports followers and following from connections/followers_and_following as classification "interaction"', async () => {
    const pipeline = await runImport();

    const followers = pipeline.filter((p) => p.item.metadata.Type === 'Instagram follower');
    expect(followers.length).toBe(2);
    for (const f of followers) {
      expect(f.item.classification).toBe('interaction');
      expect(f.item.metadata.Source).toBe('Instagram');
      expect(f.item.timestamp).toBeInstanceOf(Date);
    }

    const followerNames = await Promise.all(
      followers.map((f) => f.item.content!.data!().then((b: Buffer) => b.toString())),
    );
    expect(followerNames.some((t: string) => t.includes('johndoe'))).toBe(true);
    expect(followerNames.some((t: string) => t.includes('jane_smith'))).toBe(true);

    const following = pipeline.filter((p) => p.item.metadata.Type === 'Instagram following');
    expect(following.length).toBe(1);
    expect(following[0].item.classification).toBe('interaction');
    const followingText = (await following[0].item.content!.data!()).toString();
    expect(followingText).toContain('cool_traveler');
  });

  it('produces items with no errors and skips empty entries', async () => {
    const pipeline = await runImport();
    // 2 messages + 2 likes + 1 saved + 2 followers + 1 following
    expect(pipeline.length).toBe(8);
    for (const g of pipeline) {
      const body = (await g.item.content!.data!()).toString();
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it('respects the timeframe filter', async () => {
    const fi = new InstagramFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'instagram-html-export', fullPath: root }, {
      pipeline,
      timeframe: { since: new Date('2026-01-01T00:00:00Z') },
      log: () => {},
    } as unknown as ImportParams);
    // Only 2026 entries survive: 2 messages (May 25 + May 24 2026) + 1 like (May 04 2026)
    // + 1 follower (May 04 2026) + 1 following (Jun 21 2026).
    // The Dec 2025 like, Dec 2025 follower, and Jun 2025 saved item are filtered out.
    for (const g of pipeline) {
      expect(g.item.timestamp!.getTime()).toBeGreaterThanOrEqual(new Date('2026-01-01T00:00:00Z').getTime());
    }

    expect(pipeline.length).toBe(5);
  });
});

describe('Instagram datasource — same-minute dedup-collapse regression', () => {
  // Two DMs and two likes share the same clock minute + constant filename. With no
  // item.id, hashItem (persistence.ts) collapses them to one row each and silently
  // drops the duplicate. Each push must carry a stable, unique, idempotent id.
  function buildExport(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-dedup-'));
    const act = path.join(dir, 'your_instagram_activity');
    const inbox = path.join(act, 'messages', 'inbox', 'alice_123');
    fs.mkdirSync(inbox, { recursive: true });
    // Two messages stamped the same minute (10:51 am) — minute-precision date div.
    fs.writeFileSync(
      path.join(inbox, 'message_1.html'),
      '<!DOCTYPE html><html><head><title>Alice Example</title></head><body><main role="main">' +
        '<div class="pam"><h2>Alice Example</h2><div><div>First message</div></div>' +
        '<div class="_3-94 _a6-o">May 25, 2026 10:51 am</div></div>' +
        '<div class="pam"><h2>Alice Example</h2><div><div>Second message</div></div>' +
        '<div class="_3-94 _a6-o">May 25, 2026 10:51 am</div></div>' +
        '</main></body></html>',
    );
    // Two likes stamped the same minute (10:01 am) in one constant-filename file.
    const likes = path.join(act, 'likes');
    fs.mkdirSync(likes, { recursive: true });
    fs.writeFileSync(
      path.join(likes, 'liked_posts.html'),
      '<!DOCTYPE html><html><head><title>Liked posts</title></head><body><main role="main">' +
        '<div class="pam"><div>Liked first post</div>' +
        '<div class="_3-94 _a6-o">May 04, 2026 10:01 am</div></div>' +
        '<div class="pam"><div>Liked second post</div>' +
        '<div class="_3-94 _a6-o">May 04, 2026 10:01 am</div></div>' +
        '</main></body></html>',
    );

    return dir;
  }

  async function runImport(root: string): Promise<EmittedGraph[]> {
    const fi = new InstagramFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: path.basename(root), fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    return pipeline;
  }

  it('gives every same-minute entry a unique, stable, idempotent id', async () => {
    const root = buildExport();
    try {
      const first = await runImport(root);
      // 2 messages + 2 likes that all would otherwise collapse.
      expect(first.length).toBe(4);
      const ids = first.map((g) => g.item.id!);
      // (a) every id truthy
      for (const id of ids) {
        expect(id).toBeTruthy();
      }

      // (b) all ids distinct — no collapse
      expect(new Set(ids).size).toBe(first.length);
      // (c) re-import yields identical ids (idempotent)
      const second = await runImport(root);
      expect(second.map((g) => g.item.id!)).toEqual(ids);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
