import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { isIntegrityConstraintViolation } from '@ci/common/constants';
import { normalizeEmbeddableType } from '@ci/common/embeddings';
import { LoggerService } from '@ci/common/logging';
import { EventService } from '@ci/domains/events';
import {
  CalendarEventService,
  GraphUtilityService,
  GraphNodeEntity,
  RelationshipEntity,
  type PurgedEvent,
} from '@ci/domains/memory';
import { ConceptRemovedEvent, PersonRemovedEvent, PlaceRemovedEvent } from '@ci/domains/memory/events';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolError, ToolExecutionContext } from '../core/types';

const ForgetKnowledgeInputBaseSchema = z.object({
  entityIds: z.array(z.string().uuid()).optional(),
  relationshipIds: z.array(z.string().uuid()).optional(),
  mode: z.enum(['archive', 'archive_and_delete']).default('archive'),
  reason: z.string().min(1).optional(),
});

const ForgetKnowledgeInputSchema = ForgetKnowledgeInputBaseSchema.refine(
  (value) => value.entityIds?.length || value.relationshipIds?.length,
  {
    message: 'Provide entityIds and/or relationshipIds to forget',
  },
);

export type ForgetKnowledgeInput = z.infer<typeof ForgetKnowledgeInputSchema>;

export interface ForgetKnowledgeOutput {
  archivedEntityIds: string[];
  archivedRelationshipIds: string[];
  /**
   * The events among `archivedEntityIds` that archive mode moved to the trash
   * (the same tombstone `deleteEvent` writes) rather than just deactivating a
   * graph node. `restoreEvent` brings each one back as it was.
   */
  restorableEventIds?: string[];
  /**
   * The content that was attached to the events `archive_and_delete` destroyed,
   * and went with them. It is not in `archivedEntityIds`: the caller named the
   * events, not this.
   */
  purgedContentIds?: string[];
  mode: 'archive' | 'archive_and_delete';
  warnings?: string[];
}

/**
 * A delete that stopped partway. Events are purged one at a time, each in its own
 * transaction, and before the rest of the call, so when something fails the events
 * already purged are gone and stay gone. This says which, rather than leaving the
 * caller to find out by trying again.
 *
 * `entityId` is the event whose purge failed, or absent when it was the rest of the
 * call that did (a batch of graph nodes deleted together, so no single one is to blame).
 */
class PartialForgetError extends Error {
  constructor(
    readonly deletedEntityIds: string[],
    cause: unknown,
    readonly entityId?: string,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const what = entityId ? `Entity ${entityId} could not be deleted` : 'The delete failed';

    super(`${what}: ${reason}.${alreadyDeleted(deletedEntityIds)}`, { cause });
    this.name = 'PartialForgetError';
  }
}

function alreadyDeleted(ids: string[]): string {
  return ids.length ? ` Already deleted: ${ids.join(', ')}.` : '';
}

@Injectable()
export class ForgetKnowledgeTool extends BaseTool<ForgetKnowledgeInput, ForgetKnowledgeOutput> {
  readonly schema: IntentDefinition = {
    name: 'memory.forget',
    domain: 'memory',
    title: 'Forget knowledge',
    privacy: { access: 'delete', sensitivity: 'personal', destructive: true, external: false },
    // A delete is authoritative on the appliance. A device holding a partial mirror cannot show the
    // user everything a forget would remove, so it cannot honestly ask for the confirmation this
    // needs — resolveDispatch queues it regardless, and this says the same thing about the data.
    localCapable: false,
    consumes: ['concept', 'person'],
    phrases: ['Forget $fact', 'Delete what you know about $topic'],
    description: 'Archive or remove entities and relationships from the knowledge graph.',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        entityIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description: 'Entity identifiers to archive or delete.',
        },
        relationshipIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description: 'Relationship identifiers to archive or delete.',
        },
        mode: {
          type: 'string',
          enum: ['archive', 'archive_and_delete'],
          default: 'archive',
          description:
            'Archive marks nodes/relationships inactive (an event is moved to the trash, where it can be restored). archive_and_delete erases them permanently and cannot be undone; an event goes together with the content attached to it. Use archive unless the user asked for the data to be erased.',
        },
        reason: {
          type: 'string',
          description: 'Optional description for why the knowledge was forgotten.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    examples: [
      {
        input: {
          entityIds: ['11111111-1111-1111-1111-111111111111'],
          mode: 'archive',
        },
        output: {
          archivedEntityIds: ['11111111-1111-1111-1111-111111111111'],
          archivedRelationshipIds: [],
          mode: 'archive',
        },
        description: 'Archive an entity and its outgoing relationships (soft-deactivate)',
      },
    ],
  };

  constructor(
    private readonly graphUtility: GraphUtilityService,
    private readonly eventService: EventService,
    private readonly calendarEvents: CalendarEventService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(ForgetKnowledgeTool.name);
  }

  protected validateInput(input: unknown): ForgetKnowledgeInput {
    return ForgetKnowledgeInputSchema.parse(input);
  }

  protected async executeInternal(
    context: ToolExecutionContext,
    input: ForgetKnowledgeInput,
  ): Promise<ForgetKnowledgeOutput> {
    if (!context.userId) {
      throw new Error('User context is required to forget knowledge');
    }

    const ownerId = context.userId;
    const mode = input.mode ?? 'archive';

    const entityIds = Array.from(new Set(input.entityIds ?? []));
    const relationshipIds = Array.from(new Set(input.relationshipIds ?? []));

    const warnings: string[] = [];

    const hardDelete = mode === 'archive_and_delete';

    const entitySnapshots = [] as Array<{
      node: GraphNodeEntity;
      relationships: RelationshipEntity[];
    }>;

    const relationshipIdsToDisable = new Set<string>();

    for (const entityId of entityIds) {
      const snapshot = await this.graphUtility.collectEntitySnapshot(entityId, ownerId, {
        // Archiving deactivates the node's own outgoing edges with it. A delete
        // takes every edge, both directions, in the same transaction as the node
        // (see `deactivateEntities`), so there is nothing to collect for it, and
        // it has to find nodes that are already inactive: an event in the trash,
        // or anything archived earlier, is exactly what a delete is asked for.
        includeRelationships: !hardDelete,
        includeInactive: hardDelete,
      });

      if (!snapshot.node) {
        warnings.push(`Entity ${entityId} not found or not owned by user`);
        continue;
      }

      entitySnapshots.push({
        node: snapshot.node,
        relationships: snapshot.relationships,
      });
    }

    const uniqueEntitySnapshots = entitySnapshots;

    const explicitRelationships = relationshipIds.length
      ? await this.graphUtility.getRelationships(ownerId, {
          relationshipIds,
          includeInactive: true,
        })
      : [];

    // Deactivate or delete entities and relationships according to mode
    const nodes = uniqueEntitySnapshots.map((entry) => entry.node);
    const trashedEventIds = hardDelete ? new Set<string>() : await this.trashEvents(nodes, ownerId);
    const purged = hardDelete
      ? await this.purgeEvents(nodes, ownerId)
      : { eventIds: new Set<string>(), contentIds: [] as string[] };
    const graphSnapshots = uniqueEntitySnapshots.filter(
      (entry) => !trashedEventIds.has(entry.node.entity_id) && !purged.eventIds.has(entry.node.entity_id),
    );

    graphSnapshots.forEach((entry) =>
      entry.relationships.forEach((rel) => relationshipIdsToDisable.add(rel.relationship_id)),
    );
    explicitRelationships.forEach((rel) => relationshipIdsToDisable.add(rel.relationship_id));

    try {
      if (graphSnapshots.length) {
        await this.graphUtility.deactivateEntities(
          graphSnapshots.map((entry) => entry.node.entity_id),
          ownerId,
          hardDelete,
        );

        for (const entry of graphSnapshots) {
          await this.unindexEntity(entry.node);
        }
      }

      if (relationshipIdsToDisable.size > 0) {
        await this.graphUtility.deactivateRelationships(
          Array.from(relationshipIdsToDisable),
          ownerId,
          hardDelete,
        );
      }
    } catch (error) {
      // Events purged above cannot be taken back, so a failure here has to say so.
      throw purged.eventIds.size ? new PartialForgetError(Array.from(purged.eventIds), error) : error;
    }

    return {
      archivedEntityIds: uniqueEntitySnapshots.map((entry) => entry.node.entity_id),
      archivedRelationshipIds: Array.from(new Set(explicitRelationships.map((rel) => rel.relationship_id))),
      restorableEventIds: trashedEventIds.size ? Array.from(trashedEventIds) : undefined,
      purgedContentIds: purged.contentIds.length ? purged.contentIds : undefined,
      mode,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  /**
   * Archive events the way the app deletes them: through the event's own
   * tombstone, {@link CalendarEventService.remove}.
   *
   * An Event node is only the `ci.entities` half of an aggregate. The readers
   * of the other half — the calendar, the location-enrichment stages, HBPE,
   * search hydration — decide liveness from `ci.events.is_deleted`, and none
   * of them reads `ci.entities.is_active`, the one flag `deactivateEntities`
   * writes. So deactivating the node forgot the event from the graph and
   * nowhere else.
   *
   * `remove` writes the whole tombstone in one transaction (both halves plus
   * the graph delta), then un-indexes the event and tells HBPE. It is what
   * `deleteEvent` calls, so a forgotten event is exactly a deleted one: it sits
   * in the same trash, and `restore` brings it back.
   *
   * Its relationships are left alone, as `deleteEvent` leaves them. A tombstone
   * cascades nothing, and that is what makes `restore` exact. The event's own
   * node is inactive, and the deterministic edge matrix derives no edge onto an
   * inactive endpoint.
   *
   * `remove` answers false when there is no live detail row to tombstone: an
   * `Event` node that graph ingest created with no `ci.events` row behind it,
   * or an event deleted before `remove` deactivated the base row. Both take the
   * generic path, which deactivates the node, and that is all that is left to
   * do for either.
   */
  private async trashEvents(nodes: GraphNodeEntity[], ownerId: string): Promise<Set<string>> {
    const trashed = new Set<string>();

    for (const node of nodes) {
      // The CTI discriminator: `ci.events.entity_type` is CHECKed to it, so no
      // node of any other type has a detail row to tombstone.
      if (node.entity_type !== 'Event') {
        continue;
      }

      if (await this.calendarEvents.remove({ userId: ownerId }, node.entity_id)) {
        trashed.add(node.entity_id);
      }
    }

    return trashed;
  }

  /**
   * Delete events the way {@link trashEvents} archives them: through the event's
   * own aggregate, {@link CalendarEventService.purge}, rather than by deleting
   * its `ci.entities` row and hoping.
   *
   * That delete cannot work. It cascades to `ci.events`, where HBPE's cluster
   * membership (`hbpe.l1_event_cluster`, no `ON DELETE` action) refuses it for
   * any event HBPE has clustered, which on the reference corpus is 194,203 of
   * 198,747. `purge` clears what blocks it and what would be left dangling,
   * takes the attached content with the event, and does it all in one
   * transaction, so it either happens or it does not.
   *
   * It answers null for an `Event` node with no `ci.events` row behind it
   * (graph ingest writes those). That node takes the generic path, whose delete
   * has nothing to cascade into.
   *
   * Each event is its own transaction. When one fails, the events before it
   * are already gone, and the error says which.
   */
  private async purgeEvents(
    nodes: GraphNodeEntity[],
    ownerId: string,
  ): Promise<{ eventIds: Set<string>; contentIds: string[] }> {
    const eventIds = new Set<string>();
    const contentIds: string[] = [];

    for (const node of nodes) {
      if (node.entity_type !== 'Event') {
        continue;
      }

      let purged: PurgedEvent | null;

      try {
        purged = await this.calendarEvents.purge({ userId: ownerId }, node.entity_id);
      } catch (error) {
        throw new PartialForgetError(Array.from(eventIds), error, node.entity_id);
      }

      if (purged) {
        eventIds.add(purged.id);
        contentIds.push(...purged.contentIds);
      }
    }

    return { eventIds, contentIds };
  }

  /**
   * An integrity violation is not worth another try. `BaseTool` marks every
   * failure retryable, which is right for a timeout or a deadlock and wrong here:
   * a foreign key that still references the row refuses the same delete the same
   * way every time, and an agent told otherwise will keep asking. So it says
   * so, and says what to do instead.
   */
  protected handleError(error: unknown): ToolError {
    const partial = error instanceof PartialForgetError ? error : null;
    const cause = partial ? partial.cause : error;
    const progress = partial ? { deletedEntityIds: partial.deletedEntityIds } : {};

    if (!isIntegrityConstraintViolation(cause)) {
      const base = super.handleError(error);

      return { ...base, details: { ...base.details, ...progress } };
    }

    const driver = cause as { constraint?: string; table?: string; driverError?: Record<string, string> };
    const constraint = driver.constraint ?? driver.driverError?.constraint;
    const table = driver.table ?? driver.driverError?.table;
    // Names the entity only when it knows which one: a batch of graph nodes is deleted in one go.
    const subject = partial?.entityId ? `entity ${partial.entityId}` : 'one of the entities';
    const blocker = constraint
      ? `constraint "${constraint}"${table ? ` on table "${table}"` : ''}`
      : 'another record';

    return {
      code: 'CONSTRAINT_VIOLATION',
      message: `Cannot delete: ${blocker} still references ${subject}. Retrying will not change that. Use mode "archive" to forget without erasing.${alreadyDeleted(partial?.deletedEntityIds ?? [])}`,
      retryable: false,
      details: { constraint, table, ...progress },
    };
  }

  /**
   * Drop a forgotten node from the search index.
   *
   * `deactivateEntities` only flips `ci.entities.is_active` (or deletes the
   * row). `ci_search.vectors` / `ci_search.embeddings` are a separate store
   * keyed by (search type, id) and neither is reached by that write, so
   * without this the node keeps answering search and recall after the user
   * asked the appliance to forget it.
   *
   * This is the mirror image of how the node was indexed in the first place:
   * `GraphEventListener.emitSearchIndexEvent` re-emits the per-type
   * `*Created`/`*UpdatedEvent` after a graph write and the matching
   * `*SearchIndexListener` writes the tsvector and the embedding. The
   * `*RemovedEvent` is that same listener's other half — it is the only
   * consumer any of these three events has — and its handler deletes both rows
   * and clears the index-skip marker, so a node that is later recreated or
   * reactivated is re-indexed normally rather than suppressed by a stale skip.
   *
   * Only the types whose record IS the `ci.entities` row are handled. Every
   * other graph type (Event/Item/Content/Communication/File) is the base or
   * mirror half of a pair whose detail row `deactivateEntities` does not touch,
   * so `event.deleted` for an event that still exists in `ci.events` would be
   * false to every future consumer of that event, and unindexing it would
   * desync search from a record the rest of the app still lists. (An archived
   * Event aggregate never reaches here: {@link trashEvents} tombstones it, and
   * `CalendarEventService.remove` un-indexes it itself.)
   */
  private async unindexEntity(node: GraphNodeEntity): Promise<void> {
    // Reuses the canonical graph→search alias table rather than restating
    // which spellings ('Contact', 'Location', …) mean which search type.
    const searchType = normalizeEmbeddableType(node.entity_type);

    switch (searchType) {
      case 'person':
        await this.eventService.send(PersonRemovedEvent, { personId: node.entity_id });

        return;
      case 'place':
        await this.eventService.send(PlaceRemovedEvent, { placeId: node.entity_id });

        return;
      case 'concept':
        await this.eventService.send(ConceptRemovedEvent, { conceptId: node.entity_id });

        return;
      default:
        this.logger.debug('Forgotten entity has no graph-owned search index rows to remove', {
          entityId: node.entity_id,
          entityType: node.entity_type ?? null,
          searchType,
        });

        return;
    }
  }
}
