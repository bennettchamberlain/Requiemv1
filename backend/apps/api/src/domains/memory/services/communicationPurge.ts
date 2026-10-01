import type { EntityManager } from 'typeorm';

import { COMMUNICATION_REFERENCES, deleteBareReferences } from './purgeTeardown';

/** What one purge removed, for the caller to announce once the transaction has committed. */
export interface PurgedCommunications {
  /** The communications that went, each with the time HBPE needs to re-serialise that day. */
  communications: Array<{ id: string; time: Date }>;
}

/**
 * Permanently deletes communications, and everything that has no meaning without
 * them, inside the caller's transaction.
 *
 * Deleting the `ci.entities` base row of a communication is enough to remove the
 * communication itself. It cascades to the `ci.communications` detail row, and
 * nothing in the schema references that row, so unlike an event or content item
 * the delete is never refused. What it does is leave rows that point at nothing:
 *
 *  1. **Everything that names the id with no foreign key**
 *     ({@link deleteBareReferences}): the edges in both directions, the
 *     provenance ledger, the pipeline state and dead letters, the tags and
 *     categories, the search index and the graph deltas, whose `created` delta
 *     carries the subject line.
 *  2. **The identifier claims.** The person-link stage writes one for every
 *     address and phone number a message names, keyed by the message's id. Each
 *     is the raw sender or recipient, and the duplicate-detection stage groups
 *     them to propose that two people are one, so a claim that outlived its
 *     message would go on giving evidence from a conversation the user asked to forget.
 *
 * What it deliberately leaves alone is every record that merely MENTIONS the
 * communication. The people on it are nodes in their own right, as are the
 * summaries that were written about the period it fell in, whose
 * `related_communications_ids` still list it. Forgetting a message does not forget
 * who sent it.
 *
 * It is not {@link CommunicationService.remove}. That is the app's delete: it
 * writes a `deleted` graph delta, which carries the title, and leaves the edges,
 * ledger rows and claims where they are. This is `memory.forget`'s
 * `archive_and_delete`: a node's deltas are deleted with it and none is written.
 *
 * The rows are locked first, in key order, so two purges cannot deadlock each
 * other and so the `time` read for HBPE is the committed one: a writer that is
 * moving the message to another day holds the row, and this waits for it rather
 * than naming the day the message has just left.
 *
 * Only the caller's own communications are purged. An id that does not exist, or
 * that belongs to someone else, is left out of the result rather than raising. So
 * is a `Communication` node with no `ci.communications` row behind it, which
 * graph ingest can write: there is nothing here to cascade, and the generic node
 * delete has nothing to be refused over.
 */
export async function purgeCommunicationAggregates(
  manager: EntityManager,
  userId: string,
  requestedCommunicationIds: string[],
): Promise<PurgedCommunications> {
  const communications: Array<{ id: string; time: Date }> = await manager.query(
    `SELECT id, "time"
       FROM ci.communications
      WHERE id = ANY($1::uuid[])
        AND user_id = $2
      ORDER BY id
        FOR UPDATE`,
    [requestedCommunicationIds, userId],
  );

  if (communications.length === 0) {
    return { communications: [] };
  }

  const communicationIds = communications.map((communication) => communication.id);

  await deleteBareReferences(manager, communicationIds, COMMUNICATION_REFERENCES);
  await manager.query(
    `DELETE FROM ci.entities WHERE entity_type = 'Communication' AND entity_id = ANY($1::uuid[])`,
    [communicationIds],
  );

  return { communications };
}
