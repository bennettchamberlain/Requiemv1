/* iMessage datasource (TypeScript port)
   Consolidated minimal importer: fetches messages with basic metadata, timeframe filtering.
*/
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { attachmentMediaKind } from './attachment_extract';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, Graph, Item } from './timeline';
import { timeframeContains } from './timeline';

interface iMessageOptions {
  ownerEntityId?: number;
}

// Apple's Cocoa epoch (January 1, 2001) to Unix epoch conversion
const COCOA_EPOCH_OFFSET = Date.UTC(2001, 0, 1) / 1000;

function parseCocoaDate(cocoaTimestamp: number): Date {
  // macOS ≤10.12 stores message.date as seconds since 2001-01-01; macOS
  // 10.13+/iOS 11+ stores nanoseconds. Seconds stay below ~1e10 for
  // centuries, so anything larger is a nanosecond value.
  const seconds = cocoaTimestamp > 1e11 ? cocoaTimestamp / 1e9 : cocoaTimestamp;
  const unixSeconds = COCOA_EPOCH_OFFSET + seconds;

  return new Date(unixSeconds * 1000);
}

class iMessageFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const baseDir = entry.fullPath || entry.fsRoot || entry.filename;
    if (!baseDir) {
      return { confidence: 0 };
    }

    // Look for chat.db file in various locations
    const chatDbPaths = [
      path.join(baseDir, 'chat.db'),
      path.join(baseDir, 'Library/Messages/chat.db'),
      path.join(baseDir, '3d/3d0d7e5fb2ce288813306e4d4636395e047a3d28'), // iPhone backup path
    ];

    for (const dbPath of chatDbPaths) {
      if (fs.existsSync(dbPath)) {
        return { confidence: 0.9 };
      }
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const baseDir = entry.fullPath || entry.fsRoot || entry.filename;
    if (!baseDir) {
      return;
    }

    // Find chat.db
    const chatDbPaths = [
      path.join(baseDir, 'chat.db'),
      path.join(baseDir, 'Library/Messages/chat.db'),
      path.join(baseDir, '3d/3d0d7e5fb2ce288813306e4d4636395e047a3d28'),
    ];

    let chatDbPath: string | null = null;
    for (const dbPath of chatDbPaths) {
      if (fs.existsSync(dbPath)) {
        chatDbPath = dbPath;
        break;
      }
    }

    if (!chatDbPath) {
      params.log?.('error', 'chat.db not found', { searchPaths: chatDbPaths });

      return;
    }

    let db: Database.Database | undefined;
    try {
      db = new Database(chatDbPath, { readonly: true });
    } catch (e) {
      params.log?.('error', 'Failed to open chat.db', { error: (e as Error).message });

      return;
    }

    try {
      // Dynamic column presence checking for newer DBs (reactions, threads)
      let columns: string[] = [];
      try {
        const colsStmt = db.prepare('PRAGMA table_info(message)');
        columns = (colsStmt.all() as Array<{ name: string }>).map((r) => r.name);
      } catch {
        /* ignore */
      }

      const has = (c: string) => columns.includes(c);

      // Build a chat lookup so we can resolve the full participant list per
      // message. The `message` row only carries ONE handle_id (the sender for
      // inbound, NULL for outbound), so without joining chat_handle_join we
      // collapse every group chat to "from sender, no recipients" and lose all
      // recipient info on outbound 1:1s. macOS stores the conversation in `chat`
      // and links it via chat_message_join / chat_handle_join — self has no
      // handle row, so chat_handle_join lists only the OTHER participants.
      const chatById = new Map<
        number,
        { identifier: string | null; displayName: string | null; participants: string[] }
      >();
      const chatIdByMessage = new Map<number, number>();
      try {
        const chatRows = db
          .prepare(
            `
          SELECT c.ROWID AS chat_id, c.chat_identifier AS chat_identifier, c.display_name AS display_name, h.id AS handle_id
          FROM chat c
          LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
          LEFT JOIN handle h ON h.ROWID = chj.handle_id
        `,
          )
          .all() as Array<{
          chat_id: number;
          chat_identifier: string | null;
          display_name: string | null;
          handle_id: string | null;
        }>;
        for (const r of chatRows) {
          let entry = chatById.get(r.chat_id);
          if (!entry) {
            entry = {
              identifier: r.chat_identifier ?? null,
              displayName: r.display_name ?? null,
              participants: [],
            };
            chatById.set(r.chat_id, entry);
          }

          if (r.handle_id && !entry.participants.includes(r.handle_id)) {
            entry.participants.push(r.handle_id);
          }
        }

        for (const r of db
          .prepare('SELECT message_id, chat_id FROM chat_message_join')
          .iterate() as Iterable<{ message_id: number; chat_id: number }>) {
          chatIdByMessage.set(r.message_id, r.chat_id);
        }
      } catch (e) {
        // Older / partial chat.db dumps (and test fixtures) may not have these
        // tables. Degrade to per-message handle only rather than abort the import.
        params.log?.('debug', 'chat participant index unavailable; falling back to per-message handle', {
          error: (e as Error).message,
        });
      }

      const selectCols = [
        'message.ROWID as message_id',
        'message.guid as guid',
        'message.date as message_date',
        'message.text as message_text',
        'message.is_from_me',
        'message.service',
        has('date_read') && 'message.date_read',
        has('date_delivered') && 'message.date_delivered',
        has('is_spam') && 'message.is_spam',
        has('associated_message_guid') && 'message.associated_message_guid',
        has('associated_message_type') && 'message.associated_message_type',
        has('associated_message_emoji') && 'message.associated_message_emoji',
        has('reply_to_guid') && 'message.reply_to_guid',
        has('thread_originator_guid') && 'message.thread_originator_guid',
      ]
        .filter(Boolean)
        .join(', ');

      const stmt = db.prepare(`
        SELECT ${selectCols}, handle.id as contact_id,
               a.guid AS attachment_guid, a.filename AS attachment_filename, a.mime_type AS attachment_mime_type
        FROM message
        LEFT JOIN handle ON message.handle_id = handle.ROWID
        LEFT JOIN message_attachment_join maj ON maj.message_id = message.ROWID
        LEFT JOIN attachment a ON a.ROWID = maj.attachment_id
        ORDER BY message.date
      `);

      /**
       * One row of the message × handle × attachment join. Most columns are
       * selected conditionally (see `has(...)` above) because chat.db's schema
       * varies across macOS releases, so all but the id are optional.
       */
      interface Row {
        message_id: number;
        guid?: string | null;
        message_date?: number | null;
        message_text?: string | null;
        is_from_me?: number | null;
        service?: string | null;
        date_read?: number | null;
        date_delivered?: number | null;
        is_spam?: number | null;
        associated_message_guid?: string | null;
        associated_message_type?: number | null;
        associated_message_emoji?: string | null;
        reply_to_guid?: string | null;
        thread_originator_guid?: string | null;
        contact_id?: string | null;
        attachment_guid?: string | null;
        attachment_filename?: string | null;
        attachment_mime_type?: string | null;
      }
      const pending: Record<number, Graph> = {};

      for (const row of stmt.iterate() as Iterable<Row>) {
        const cocoa = row.message_date;
        // A row with no numeric date can't be placed on the timeline; record it
        // in the drop ledger instead of letting it vanish silently.
        if (typeof cocoa !== 'number') {
          params.pipeline.drop?.('invalid_timestamp');
          continue;
        }

        const timestamp = parseCocoaDate(cocoa);
        if (!timeframeContains(params.timeframe, timestamp)) {
          continue;
        }

        let graph = pending[row.message_id];
        if (!graph) {
          const chatId = chatIdByMessage.get(row.message_id);
          const chat = chatId != null ? chatById.get(chatId) : undefined;
          // Sender = the per-message handle when present. On outbound, handle_id
          // is NULL (self has no handle row), so sender is null even in groups.
          const senderHandle = row.is_from_me === 1 ? null : (row.contact_id ?? null);
          // Recipients = chat participants minus the sender. chat_handle_join
          // excludes self, so on outbound the participant list IS the recipient
          // list; on inbound the only thing to subtract is the sender.
          const recipients: string[] = chat
            ? senderHandle
              ? chat.participants.filter((p) => p !== senderHandle)
              : chat.participants.slice()
            : [];
          const item: Item = {
            id: row.guid ? row.guid : `imessage_${row.message_id}`,
            classification: 'message',
            timestamp,
            content: { filename: `message_${row.message_id}.txt` },
            metadata: {
              Source: 'iMessage',
              ...(row.message_text && { Text: row.message_text }),
              'From Me': row.is_from_me === 1,
              Service: row.service,
              ...(senderHandle && { Sender: senderHandle }),
              // Prefer the resolved chat participant list (handles group chats
              // and outbound recipients). Fall back to the row-level partner
              // handle only when chat tables are missing, so older / stripped
              // dumps still record the 1:1 recipient on outbound messages.
              ...(recipients.length
                ? { Recipients: recipients }
                : !chat && row.is_from_me === 1 && row.contact_id
                  ? { To: row.contact_id }
                  : {}),
              ...(chat?.identifier && { ChatId: chat.identifier }),
              ...(chat?.displayName && { GroupName: chat.displayName }),
              ...(row.date_read && { ReadAt: parseCocoaDate(row.date_read).toISOString() }),
              ...(row.date_delivered && { DeliveredAt: parseCocoaDate(row.date_delivered).toISOString() }),
              ...(row.is_spam != null && { Spam: row.is_spam === 1 }),
            },
          };
          graph = { item, edges: [] };
          pending[row.message_id] = graph;

          // Link the message to its conversation partner so the graph view has a
          // real item↔entity edge. handle.id is the other party (phone/email)
          // regardless of direction; direction is recorded on the edge metadata.
          if (row.contact_id) {
            graph.edges!.push({
              relation: 'participant',
              to: { entity: { type: 'contact', name: row.contact_id } },
              metadata: { direction: row.is_from_me === 1 ? 'outgoing' : 'incoming' },
            });
          }
        }

        // Attachments ride the message itself as metadata.MediaAttachments —
        // the comms media lane (upload + content row + the message's
        // attachments column; see graphql.ts withCommunicationMedia). They
        // used to be separate sub-items routed by MIME to events, which minted
        // a duplicate ci.events row per attachment at the message's timestamp.
        // A message with several attachments arrives as several joined rows,
        // so descriptors append to the existing array.
        if (row.attachment_guid && row.attachment_filename) {
          try {
            const attachPath = path.join(path.dirname(chatDbPath), 'Attachments', row.attachment_filename);
            if (fs.existsSync(attachPath)) {
              const meta = graph.item!.metadata as Record<string, unknown>;
              const atts = (meta.MediaAttachments as unknown[] | undefined) ?? [];
              atts.push({
                path: attachPath,
                filename: path.basename(row.attachment_filename),
                type: attachmentMediaKind(row.attachment_mime_type ?? undefined),
                mimetype: row.attachment_mime_type ?? undefined,
              });
              meta.MediaAttachments = atts;
            }
          } catch (e) {
            params.log?.('debug', 'attachment read failed', { error: (e as Error).message });
          }
        }

        // Reactions (tapbacks) are their own message row pointing at the message
        // they react to. Record the reference + reaction INLINE on this message
        // rather than emitting a separate graph for the target. A target
        // placeholder carries no timestamp, so it lands dated-now; worse, it
        // shares the target's GUID, so it out-competes the real, correctly-dated
        // target row in (data_source, content_hash) dedup and overwrites it with a
        // now-dated `message_<GUID>.txt` husk. The real target is already ingested
        // with its own timestamp; we only need a reference to it. Strip the
        // "p:<part>/" part-prefix so the reference is the bare message GUID.
        if (row.associated_message_guid && row.associated_message_type) {
          const reaction = row.associated_message_emoji || this.mapReactionType(row.associated_message_type);
          if (reaction) {
            const targetGuid = (row.associated_message_guid as string).replace(/^p:\d+\//, '');
            graph.item!.metadata!.ReactionTo = targetGuid;
            graph.item!.metadata!.Reaction = reaction;
          }
        }

        // Replies / threads — same reasoning as reactions: record the referenced
        // GUIDs on THIS (replying) message instead of emitting a placeholder item
        // for the parent. The parent is already ingested with its own timestamp; a
        // placeholder would be timestamp-less and collide with it on GUID.
        if (row.reply_to_guid && row.thread_originator_guid) {
          graph.item!.metadata!.ReplyTo = row.reply_to_guid;
          graph.item!.metadata!.ThreadOriginator = row.thread_originator_guid;
        }
      }

      // Push accumulated graphs
      Object.values(pending).forEach((g) => params.pipeline.push(g));
    } catch (error) {
      params.log?.('error', 'Failed to query iMessage database', { error: (error as Error).message });
    } finally {
      try {
        db?.close();
      } catch {
        /* ignore */
      }
    }
  }

  // Map integer reaction type codes to human-readable fallback (subset)
  // Based on Go implementation heuristic (2006 reaction placed)
  private mapReactionType(code: number): string | undefined {
    const mapping: Record<number, string> = {
      2000: 'love',
      2001: 'like',
      2002: 'dislike',
      2003: 'laugh',
      2004: 'emphasize',
      2005: 'question',
      2006: 'emoji',
    };

    return mapping[code];
  }
}

registerDataSource({
  name: 'imessage',
  title: 'iMessage',
  icon: 'imessage.svg',
  description: 'Import messages from iMessage chat.db',
  newOptions: () => ({ ownerEntityId: undefined }) as iMessageOptions,
  newFileImporter: () => new iMessageFileImporter(),
});
