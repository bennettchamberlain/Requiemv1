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

const EXTRACTION_SYSTEM_PROMPT = `You are a personal knowledge graph assistant. Your job is to extract PERSONAL biographical facts about the user from informal memory fragments.

Return ONLY valid JSON with no markdown, no code fences, no extra text:
{"entities":[{"type":"<type>","name":"<name>","description":"<optional>"}],"relationships":[{"fromName":"<name>","fromType":"<type>","toName":"<name>","toType":"<type>","relationshipType":"<UPPER_SNAKE_CASE>"}]}

Entity types (use ONLY these exact strings — reject anything else):
  person   — a human being the user knows or is
  concept  — a hobby, preference, skill, topic, or abstract idea the user cares about
  place    — a city, building, venue, or geographic area the user has been to or lives near
  event    — something that happened or will happen to the user at a specific time
  item     — a physical object or possession the user owns or uses
  content  — a book, film, article, or piece of media the user has engaged with

Relationship types: KNOWS, LIVES_IN, WORKS_AT, INTERESTED_IN, OWNS, ATTENDED, LIKES, DISLIKES, HAS_SKILL, RELATED_TO

Rules — read carefully:
1. ONLY extract personal facts about the human user (their life, preferences, people they know, places they've been).
2. SKIP fragments that are code snippets, technical notes, API docs, commands, or configuration — these contain no personal facts.
3. SKIP fragments that are too vague or contain no personally meaningful information.
4. ONLY include relationships where BOTH endpoints appear in the entities list.
5. If nothing qualifies, return exactly: {"entities":[],"relationships":[]}`;

/** Allowed entity type strings from the LLM. Anything else is discarded. */
const VALID_ENTITY_TYPES = new Set(['person', 'concept', 'place', 'event', 'item', 'content']);

/** Maximum characters per fragment sent to the LLM. Longer content is truncated. */
const MAX_FRAGMENT_CHARS = 600;

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
        const body = note.content ?? '';
        const truncated = body.length > MAX_FRAGMENT_CHARS ? `${body.slice(0, MAX_FRAGMENT_CHARS)}…` : body;

        return `${label}\n${truncated}`;
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

      if (!VALID_ENTITY_TYPES.has(entity.type)) {
        this.logger.debug('Skipping entity with invalid type', { type: entity.type, name });
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
      // Guard against the LLM omitting required fields.
      if (
        !rel.fromName?.trim() ||
        !rel.fromType?.trim() ||
        !rel.toName?.trim() ||
        !rel.toType?.trim() ||
        !rel.relationshipType?.trim()
      ) {
        this.logger.debug('Skipping relationship: missing required fields', { rel });
        continue;
      }

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
    return `${(type ?? '').toLowerCase()}:${(name ?? '').toLowerCase()}`;
  }

  private parseExtractionResult(content: string): ExtractionResult {
    const empty: ExtractionResult = { entities: [], relationships: [] };

    // Strip markdown code fences the model may wrap around the JSON.
    let text = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    // If the model prepended text before the JSON object, find the first '{'.
    const brace = text.indexOf('{');
    if (brace > 0) {
      text = text.slice(brace);
    }

    // If the JSON appears truncated (no closing brace for the root object),
    // there's nothing we can safely salvage — bail early.
    if (!text.endsWith('}')) {
      this.logger.warn('LLM extraction result appears truncated; skipping', {
        preview: content.slice(0, 200),
      });

      return empty;
    }

    try {
      const parsed: unknown = JSON.parse(text);

      if (typeof parsed !== 'object' || parsed === null) {
        return empty;
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

      return empty;
    }
  }
}
