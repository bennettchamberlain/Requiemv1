import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import { allDataSources } from '../registry';
import type { DirEntry } from '../registry';
import type { Graph, ImportParams, Relationship } from '../timeline';

import type { EmittedGraph } from './support/emitted';
import { metaAttachments } from './support/emitted';

import '../imessage';

function getImporter(name: string) {
  const ds = allDataSources().find((d) => d.name === name);
  if (!ds?.newFileImporter) {
    throw new Error('missing importer');
  }

  return ds.newFileImporter();
}

describe('imessage importer', () => {
  it('recognizes directory with chat.db and Attachments', async () => {
    const importer = getImporter('imessage');
    const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'imsg-'));
    await fs.promises.mkdir(path.join(dir, 'Attachments'));
    await fs.promises.writeFile(path.join(dir, 'chat.db'), '');
    const rec = await importer.recognize({}, { filename: dir, fullPath: dir } as DirEntry, {});
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('carries the attachment on the message as a MediaAttachments descriptor with the row MIME', async () => {
    const importer = getImporter('imessage');
    const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'imsg-'));

    // Write the attachment file under Attachments/ so it exists on disk.
    await fs.promises.mkdir(path.join(dir, 'Attachments'));
    const attachmentFilename = 'photo.jpg';
    await fs.promises.writeFile(path.join(dir, 'Attachments', attachmentFilename), 'jpeg-bytes');

    // Build a minimal chat.db with one message that has one attachment.
    const db = new Database(path.join(dir, 'chat.db'));
    db.exec(`
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, text TEXT, is_from_me INTEGER, service TEXT, handle_id INTEGER);
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT, filename TEXT, mime_type TEXT);
      CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    `);
    db.prepare('INSERT INTO handle (ROWID, id) VALUES (1, ?)').run('+15551234567');
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (1, ?, ?, ?, 0, ?, 1)',
    ).run('msg-guid-1', 700000000000000000, 'see attached', 'iMessage');
    db.prepare('INSERT INTO attachment (ROWID, guid, filename, mime_type) VALUES (1, ?, ?, ?)').run(
      'att-guid-1',
      attachmentFilename,
      'image/jpeg',
    );
    db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (1, 1)').run();
    db.close();

    const pipeline: EmittedGraph[] = [];
    await importer.fileImport(
      {},
      { filename: dir, fullPath: dir } as DirEntry,
      {
        pipeline: { push: (g: Graph) => pipeline.push(g as EmittedGraph) },
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams,
    );

    const messageGraph = pipeline.find((g) => g.item?.classification === 'message');
    expect(messageGraph).toBeDefined();
    // No attachment sub-item edge — that used to mint a duplicate ci.events row.
    expect(messageGraph!.edges?.some((e: Relationship) => e.relation === 'attachment')).toBeFalsy();
    const atts = metaAttachments(messageGraph!.item.metadata.MediaAttachments);
    expect(atts).toHaveLength(1);
    expect(atts[0].mimetype).toBe('image/jpeg');
    expect(atts[0].type).toBe('image');
    expect(atts[0].filename).toBe('photo.jpg');
    expect(atts[0].path.endsWith(path.join('Attachments', 'photo.jpg'))).toBe(true);
  });

  // Regression: reactions/replies used to emit a *placeholder* message item for
  // the referenced message — an item with the target's GUID but NO timestamp.
  // That husk landed dated-now (default time = now()) and, sharing the target's
  // GUID, out-competed the real target row in (data_source, content_hash) dedup,
  // flooding the "Today" view with `message_<GUID>.txt` comms. The fix records
  // the reference as metadata on the real (reacting/replying) message instead, so
  // no emitted item is ever timestamp-less.
  it('records reactions/replies as metadata, never as timestamp-less placeholder items', async () => {
    const importer = getImporter('imessage');
    const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'imsg-'));
    const db = new Database(path.join(dir, 'chat.db'));
    db.exec(`
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, text TEXT, is_from_me INTEGER, service TEXT, handle_id INTEGER,
        associated_message_guid TEXT, associated_message_type INTEGER, associated_message_emoji TEXT, reply_to_guid TEXT, thread_originator_guid TEXT);
      CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT, filename TEXT, mime_type TEXT);
      CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    `);
    db.prepare('INSERT INTO handle (ROWID, id) VALUES (1, ?)').run('+15551234567');
    // Real target message, dated long ago.
    const cocoa2020 = Date.UTC(2020, 0, 1) / 1000 - Date.UTC(2001, 0, 1) / 1000;
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (1, ?, ?, ?, 0, ?, 1)',
    ).run('target-guid', cocoa2020, 'the original message', 'iMessage');
    // Reaction row pointing at target-guid (part-prefixed, as real DBs store it).
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id, associated_message_guid, associated_message_type) VALUES (2, ?, ?, NULL, 1, ?, 1, ?, ?)',
    ).run('reaction-guid', cocoa2020 + 60, 'iMessage', 'p:0/target-guid', 2000);
    // Reply row pointing at target-guid.
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id, reply_to_guid, thread_originator_guid) VALUES (3, ?, ?, ?, 0, ?, 1, ?, ?)',
    ).run('reply-guid', cocoa2020 + 120, 'a reply', 'iMessage', 'target-guid', 'target-guid');
    db.close();

    const pushed: Graph[] = [];
    await importer.fileImport(
      {},
      { filename: dir, fullPath: dir } as DirEntry,
      { pipeline: { push: (g: Graph) => pushed.push(g as EmittedGraph) } } as unknown as ImportParams,
    );

    // Core guard: every emitted item carries a real timestamp — no husk defaults
    // to now() downstream.
    expect(pushed.every((g) => g.item?.timestamp instanceof Date)).toBe(true);
    // No placeholder husk for the referenced message.
    expect(pushed.some((g) => g.item?.content?.filename === 'message_target-guid.txt')).toBe(false);
    // Exactly one graph per GUID — the real target is not duplicated/overwritten.
    expect(pushed.filter((g) => g.item?.id === 'target-guid')).toHaveLength(1);

    // Real target survives with its real text and date.
    const target = pushed.find((g) => g.item?.id === 'target-guid')!;
    expect(target.item!.metadata!['Text']).toBe('the original message');
    expect(target.item!.timestamp!.getUTCFullYear()).toBe(2020);

    // Reaction linkage rides on the reacting message.
    const reaction = pushed.find((g) => g.item?.id === 'reaction-guid')!;
    expect(reaction.item!.metadata!['ReactionTo']).toBe('target-guid');
    expect(reaction.item!.metadata!['Reaction']).toBeTruthy();

    // Reply linkage rides on the replying message.
    const reply = pushed.find((g) => g.item?.id === 'reply-guid')!;
    expect(reply.item!.metadata!['ReplyTo']).toBe('target-guid');
    expect(reply.item!.metadata!['ThreadOriginator']).toBe('target-guid');
  });

  // Regression: without joining chat_handle_join, every group chat collapses to
  // "from sender, no recipients" — message.handle_id is just the sender (or
  // NULL on outbound), so the other participants vanish. We resolve the full
  // chat membership and emit Recipients[] minus the sender, plus ChatId /
  // GroupName so the conversation is identifiable downstream.
  it('emits Recipients[] + ChatId/GroupName by joining chat_handle_join', async () => {
    const importer = getImporter('imessage');
    const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'imsg-'));
    const db = new Database(path.join(dir, 'chat.db'));
    db.exec(`
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, text TEXT, is_from_me INTEGER, service TEXT, handle_id INTEGER);
      CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT, filename TEXT, mime_type TEXT);
      CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
      CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT);
      CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
      CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    `);
    db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(1, '+15551110001');
    db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(2, '+15551110002');
    db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(3, '+15551110003');

    // 1:1 chat with handle 1
    db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
      100,
      '+15551110001',
      null,
    );
    db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(100, 1);
    // Group chat with handles 2 and 3
    db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
      200,
      'chat200',
      'Lunch Crew',
    );
    db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(200, 2);
    db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(200, 3);

    // 1:1 outbound to handle 1 — recipients = [+15551110001]
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (?,?,?,?,?,?,?)',
    ).run(10, 'out11-guid', 600000000, 'hi', 1, 'iMessage', null);
    db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(100, 10);
    // 1:1 inbound from handle 1 — sender = +15551110001, recipients = []
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (?,?,?,?,?,?,?)',
    ).run(11, 'in11-guid', 600000001, 'hey', 0, 'iMessage', 1);
    db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(100, 11);
    // Group outbound — recipients = all chat participants (+...0002, +...0003)
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (?,?,?,?,?,?,?)',
    ).run(20, 'outg-guid', 600000002, 'lunch?', 1, 'iMessage', null);
    db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(200, 20);
    // Group inbound from handle 2 — sender = +...0002, recipients = [+...0003]
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (?,?,?,?,?,?,?)',
    ).run(21, 'ing-guid', 600000003, 'yes', 0, 'iMessage', 2);
    db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(200, 21);
    db.close();

    const pushed: Graph[] = [];
    await importer.fileImport(
      {},
      { filename: dir, fullPath: dir } as DirEntry,
      { pipeline: { push: (g: Graph) => pushed.push(g as EmittedGraph) } } as unknown as ImportParams,
    );

    const out11 = pushed.find((g) => g.item?.id === 'out11-guid')!;
    expect(out11.item!.metadata!['Recipients']).toEqual(['+15551110001']);
    expect(out11.item!.metadata!['Sender']).toBeUndefined();
    expect(out11.item!.metadata!['ChatId']).toBe('+15551110001');
    expect(out11.item!.metadata!['GroupName']).toBeUndefined();
    expect(out11.item!.metadata!['To']).toBeUndefined();

    const in11 = pushed.find((g) => g.item?.id === 'in11-guid')!;
    expect(in11.item!.metadata!['Sender']).toBe('+15551110001');
    expect(in11.item!.metadata!['Recipients']).toBeUndefined();
    expect(in11.item!.metadata!['ChatId']).toBe('+15551110001');

    const outg = pushed.find((g) => g.item?.id === 'outg-guid')!;
    expect(outg.item!.metadata!['Recipients']).toEqual(['+15551110002', '+15551110003']);
    expect(outg.item!.metadata!['Sender']).toBeUndefined();
    expect(outg.item!.metadata!['ChatId']).toBe('chat200');
    expect(outg.item!.metadata!['GroupName']).toBe('Lunch Crew');

    const ing = pushed.find((g) => g.item?.id === 'ing-guid')!;
    expect(ing.item!.metadata!['Sender']).toBe('+15551110002');
    expect(ing.item!.metadata!['Recipients']).toEqual(['+15551110003']);
    expect(ing.item!.metadata!['GroupName']).toBe('Lunch Crew');
  });

  it('maps the partner direction-aware: outbound -> To, inbound -> Sender', async () => {
    const importer = getImporter('imessage');
    const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'imsg-'));
    const dbPath = path.join(dir, 'chat.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, text TEXT, is_from_me INTEGER, service TEXT, handle_id INTEGER);
      CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT, filename TEXT, mime_type TEXT);
      CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    `);
    db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(1, '+15551234567');
    // outbound (is_from_me=1): partner is the recipient
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (?,?,?,?,?,?,?)',
    ).run(10, 'out-guid', 600000000, 'hi there', 1, 'iMessage', 1);
    // inbound (is_from_me=0): partner is the sender
    db.prepare(
      'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (?,?,?,?,?,?,?)',
    ).run(11, 'in-guid', 600000001, 'hey back', 0, 'iMessage', 1);
    db.close();

    const pushed: Graph[] = [];
    await importer.fileImport(
      {},
      { filename: dir, fullPath: dir } as DirEntry,
      { pipeline: { push: (g: Graph) => pushed.push(g as EmittedGraph) } } as unknown as ImportParams,
    );

    const out = pushed.find((g) => g.item?.id === 'out-guid')!;
    const inb = pushed.find((g) => g.item?.id === 'in-guid')!;
    // outbound: partner rides as the recipient (To), not as Contact/Sender
    expect(out.item!.metadata!['To']).toBe('+15551234567');
    expect(out.item!.metadata!['Sender']).toBeUndefined();
    expect(out.item!.metadata!['Contact']).toBeUndefined();
    expect(out.item!.metadata!['From Me']).toBe(true);
    // inbound: partner rides as the sender, no recipient
    expect(inb.item!.metadata!['Sender']).toBe('+15551234567');
    expect(inb.item!.metadata!['To']).toBeUndefined();
    expect(inb.item!.metadata!['Contact']).toBeUndefined();
    expect(inb.item!.metadata!['From Me']).toBe(false);
  });
});
