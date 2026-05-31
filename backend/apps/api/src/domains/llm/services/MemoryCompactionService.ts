/**
 * MemoryCompactionService
 *
 * Takes a batch of raw memory fragments (ci.notes rows written by the
 * Hermes on_memory_write hook) for a single user, runs a local LLM
 * extraction pass to pull out entities and relationships, writes them
 * into the knowledge graph, then stamps processed_at on every note.
 *
 * Called by MemoryCompactionCron, not by HTTP handlers.
 */

import { Injectable } from '@nestjs/common';
import type { Message as OllamaMessage } from 'ollama';

import { SYSTEM_USER, type ServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { GraphEventService, GraphNodeEntity, GraphQueryService } from '@ci/domains/memory';
import { NoteService, type Note } from '@ci/domains/notes';

import { OllamaService, PROMPT_MODEL } from './OllamaService';

// ---------------------------------------------------------------------------
// LLM prompt
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `You are a personal knowledge graph assistant. Extract structured entities and relationships from informal memory fragments written by or about a user.

Return ONLY valid JSON in exactly this format, with no additional text or markdown:
{
  "entities": [
    { "type": "person|concept|place|event|item|content", "name": "string", "description": "string (optional)", "properties": {} }
  ],
  "relationships": [
    { "fromName": "string", "fromType": "string", "toName": "string", "toType": "string", "relationshipType": "UPPER_SNAKE_CASE", "bidirectional": false }
  ]
}

Entity type guidelines:
- person  : any individual human being
- concept : an idea, topic, skill, preference, or abstract category
- place   : a location, venue, or geographic area
- event   : something that happened or will happen at a specific time
- item    : a physical object, product, or possession
- content : a document, book, article, movie, or media piece

Relationship type guidelines (use UPPER_SNAKE_CASE):
  KNOWS, LIVES_IN, WORKS_AT, INTERESTED_IN, OWNS, ATTENDED,
  LIKES, DISLIKES, HAS_SKILL, RELATED_TO, PART_OF, CREATED_BY

Rules:
- Only extract clearly stated facts, never assumptions or inferences.
- Skip fragments that are too vague to yield meaningful structure.
- Only include relationships where BOTH endpoints appear in the entities list above.
- If nothing meaningful can be extracted, return exactly: {"entities":[],"relationships":[]}`;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ExtractedEntity {
  type: string;
  name: string;
  description?: string;
  properties?: Record<string, unknown>;
}

interface ExtractedRelationship {
  fromName: string;
  fromType: string;
  toName: string;
  toType: string;
  relationshipType: string;
  bidirectional?: boolean;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class MemoryCompactionService {
  constructor(
    private readonly ollamaService: OllamaService,
    private readonly noteService: NoteService,
    private readonly graphEvents: GraphEventService,
    private readonly graphQuery: GraphQueryService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MemoryCompactionService.name);
  }

  /**
   * Process a batch of note fragments for one user:
   *   1. Send fragments to the LLM for structured extraction.
   *   2. Upsert extracted entities into the knowledge graph (dedup by name+type).
   *   3. Upsert extracted relationships.
   *   4. Stamp processed_at on every note regardless of extraction outcome,
   *      so a malformed response doesn't cause the same fragment to be
   *      re-submitted on every cron tick.
   */
  async compactForUser(userId: string, notes: Note[]): Promise<void> {
    if (notes.length === 0) {
      return;
    }

    this.logger.log('Compacting memory fragments', { userId, fragmentCount: notes.length });

    // ------------------------------------------------------------------
    // 1. LLM extraction
    // ------------------------------------------------------------------

    const fragmentsText = notes
      .map((note, index) => {
        const label = note.title ? `[${note.title}]` : `[Fragment ${index + 1}]`;

        return `${label}\n${note.content ?? ''}`;
      })
      .join('\n\n---\n\n');

    const messages: OllamaMessage[] = [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Extract entities and relationships from these memory fragments:\n\n${fragmentsText}`,
      },
    ];

    let extracted: ExtractionResult = { entities: [], relationships: [] };

    try {
      // We intentionally pass an empty context object: this is a background job
      // with no HTTP request context.  OllamaService accepts {} here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.ollamaService.chat({} as any, messages, {
        model: PROMPT_MODEL,
        format: 'json',
      });

      extracted = this.parseExtractionResult(response.message.content);

      this.logger.log('Extracted knowledge from fragments', {
        userId,
        entityCount: extracted.entities.length,
        relationshipCount: extracted.relationships.length,
      });
    } catch (err) {
      this.logger.error(
        'LLM extraction call failed; notes will be marked processed to avoid re-submission',
        err instanceof Error ? err : new Error(String(err)),
      );
      // Fall through — still mark notes processed below.
    }

    // ------------------------------------------------------------------
    // 2. Upsert entities; build a lookup map for relationship wiring
    // ------------------------------------------------------------------

    /** `"type:name_lower"` → entityId */
    const entityMap = new Map<string, string>();

    for (const entity of extracted.entities) {
      const name = entity.name?.trim();
      if (!name) {
        continue;
      }

      try {
        const existing = await this.findExistingEntity(userId, entity.type, name);

        const { entityId } = await this.graphEvents.upsertNode(userId, {
          entityId: existing?.entity_id,
          entityType: entity.type,
          name,
          description: entity.description ?? null,
          properties: entity.properties ?? {},
          // Merge properties on update so we don't overwrite existing data.
          mergeProperties: existing != null,
        });

        entityMap.set(this.entityKey(entity.type, name), entityId);
      } catch (err) {
        this.logger.warn('Failed to upsert entity', {
          userId,
          entityName: entity.name,
          entityType: entity.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ------------------------------------------------------------------
    // 3. Upsert relationships
    // ------------------------------------------------------------------

    for (const rel of extracted.relationships) {
      const fromId = entityMap.get(this.entityKey(rel.fromType, rel.fromName));
      const toId = entityMap.get(this.entityKey(rel.toType, rel.toName));

      if (!fromId || !toId) {
        this.logger.debug('Skipping relationship: one or both endpoints not in extraction batch', {
          fromName: rel.fromName,
          toName: rel.toName,
        });
        continue;
      }

      try {
        await this.graphEvents.upsertRelationship(userId, {
          fromEntityId: fromId,
          toEntityId: toId,
          relationshipType: rel.relationshipType,
          isBidirectional: rel.bidirectional ?? false,
          mergeProperties: false,
        });
      } catch (err) {
        this.logger.warn('Failed to upsert relationship', {
          userId,
          fromName: rel.fromName,
          toName: rel.toName,
          type: rel.relationshipType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ------------------------------------------------------------------
    // 4. Mark all notes as processed (regardless of extraction success)
    // ------------------------------------------------------------------

    await this.noteService.markProcessed(
      { userId: SYSTEM_USER } as ServiceContext,
      notes.map((note) => note.id),
    );

    this.logger.log('Memory compaction complete', { userId, fragmentCount: notes.length });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async findExistingEntity(
    userId: string,
    type: string,
    name: string,
  ): Promise<GraphNodeEntity | null> {
    const candidates = await this.graphQuery.getNodes(userId, {
      entityType: type,
      nameContains: name,
      limit: 5,
    });

    return candidates.find((n) => n.name?.toLowerCase() === name.toLowerCase()) ?? null;
  }

  private entityKey(type: string, name: string): string {
    return `${type.toLowerCase()}:${name.toLowerCase()}`;
  }

  private parseExtractionResult(content: string): ExtractionResult {
    try {
      const parsed: unknown = JSON.parse(content);

      if (typeof parsed !== 'object' || parsed === null) {
        return { entities: [], relationships: [] };
      }

      const obj = parsed as Record<string, unknown>;

      return {
        entities: Array.isArray(obj['entities']) ? (obj['entities'] as ExtractedEntity[]) : [],
        relationships: Array.isArray(obj['relationships'])
          ? (obj['relationships'] as ExtractedRelationship[])
          : [],
      };
    } catch {
      this.logger.warn('Failed to parse LLM extraction result as JSON', {
        preview: content.slice(0, 300),
      });

      return { entities: [], relationships: [] };
    }
  }
}
