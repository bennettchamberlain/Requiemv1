/**
 * MemoryCompactionService
 *
 * Takes a batch of raw agent memory fragments (ci.agent_memory rows written
 * by the Hermes on_memory_write hook) for a single user, runs a local LLM
 * extraction pass to pull out entities and relationships, writes them into
 * the knowledge graph, then stamps processed_at on every fragment.
 *
 * Called by MemoryCompactionCron (periodic) and MemoryController (manual).
 *
 * Deduplication strategy:
 *   - person / concept : exact name match via PersonService / ConceptService
 *   - place / event / item / content : always create a new graph node
 *     (these types lack a reliable name-search API at this stage)
 */

import { Injectable } from '@nestjs/common';
import type { Message as OllamaMessage } from 'ollama';

import {
  SYSTEM_USER,
  type RequestContext,
  type ServiceContext,
  type UserServiceContext,
} from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { RelationshipService } from '@ci/domains/graph';
import { OllamaService, PROMPT_MODEL } from '@ci/domains/llm';
import { ConceptService, ItemService, PersonService, PlaceService } from '@ci/domains/memory';

import type { AgentMemory } from '../entities/AgentMemoryEntity';
import { AgentMemoryService } from '../services/AgentMemoryService';

// ---------------------------------------------------------------------------
// LLM extraction prompt
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

Relationship types: KNOWS, FRIENDS_WITH, FAMILY_MEMBER, LIVES_IN, WORKS_AT, STUDIES_AT, VISITED, OWNS, INTERESTED_IN, PREFERS, DISLIKES, PARTICIPATED_IN, ASSOCIATED_WITH

Rules — read carefully:
1. ONLY extract personal facts about the human user (their life, preferences, people they know, places they've been).
2. SKIP fragments that are code snippets, technical notes, API docs, commands, or configuration.
3. SKIP fragments that are too vague or contain no personally meaningful information.
4. ONLY include relationships where BOTH endpoints appear in the entities list.
5. If nothing qualifies, return exactly: {"entities":[],"relationships":[]}`;

/** Allowed entity type strings. Anything else is discarded. */
const VALID_ENTITY_TYPES = new Set(['person', 'concept', 'place', 'event', 'item', 'content']);

/** Maximum characters per fragment sent to the LLM. */
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
    private readonly agentMemoryService: AgentMemoryService,
    private readonly personService: PersonService,
    private readonly conceptService: ConceptService,
    private readonly placeService: PlaceService,
    private readonly itemService: ItemService,
    private readonly relationshipService: RelationshipService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MemoryCompactionService.name);
  }

  /**
   * Process a batch of agent memory fragments for one user:
   *   1. Send fragments to the LLM for structured extraction.
   *   2. Upsert extracted entities via the per-type domain services so their
   *      `*.created` events fire and downstream indexers see the new rows.
   *   3. Upsert extracted relationships.
   *   4. Stamp processed_at on every fragment regardless of outcome.
   */
  async compactForUser(context: UserServiceContext, fragments: AgentMemory[]): Promise<void> {
    if (fragments.length === 0) {
      return;
    }

    const { userId } = context;

    this.logger.log('Compacting agent memory fragments', {
      userId,
      fragmentCount: fragments.length,
    });

    // ------------------------------------------------------------------
    // 1. LLM extraction
    // ------------------------------------------------------------------

    const fragmentsText = fragments
      .map((f, index) => {
        const label = f.title ?? (f.source ? `[${f.source}]` : `[Fragment ${index + 1}]`);
        const body = f.content;
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
      const response = await this.ollamaService.chat({ userId } satisfies RequestContext, messages, {
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
        'LLM extraction failed; fragments will be marked processed to prevent re-submission',
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // ------------------------------------------------------------------
    // 2. Upsert entities
    // ------------------------------------------------------------------

    /** `"type:name_lower"` → entityId in ci.entities */
    const entityMap = new Map<string, string>();

    for (const entity of extracted.entities) {
      const name = entity.name?.trim();

      if (!name || !VALID_ENTITY_TYPES.has(entity.type)) {
        this.logger.debug('Skipping entity with missing name or invalid type', {
          type: entity.type,
          name,
        });
        continue;
      }

      try {
        const entityId = await this.upsertEntity(context, entity.type, name, entity.description ?? null);

        if (entityId != null) {
          entityMap.set(this.entityKey(entity.type, name), entityId);
        }
      } catch (err) {
        this.logger.warn('Failed to upsert entity', {
          userId,
          name,
          type: entity.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ------------------------------------------------------------------
    // 3. Upsert relationships
    // ------------------------------------------------------------------

    for (const rel of extracted.relationships) {
      if (
        !rel.fromName?.trim() ||
        !rel.fromType?.trim() ||
        !rel.toName?.trim() ||
        !rel.toType?.trim() ||
        !rel.relationshipType?.trim()
      ) {
        this.logger.debug('Skipping relationship with missing required fields', { rel });
        continue;
      }

      const fromId = entityMap.get(this.entityKey(rel.fromType, rel.fromName));
      const toId = entityMap.get(this.entityKey(rel.toType, rel.toName));

      if (!fromId || !toId) {
        this.logger.debug('Skipping relationship: endpoints not in extraction batch', {
          fromName: rel.fromName,
          toName: rel.toName,
        });
        continue;
      }

      const relType = this.relationshipService.resolveType(rel.relationshipType, rel.fromType, rel.toType);

      if (relType == null) {
        this.logger.debug('Skipping relationship with unsupported type for endpoint pair', {
          relationshipType: rel.relationshipType,
          fromType: rel.fromType,
          toType: rel.toType,
        });
        continue;
      }

      try {
        await this.relationshipService.upsert(context, {
          fromNodeId: fromId,
          fromNodeType: rel.fromType,
          toNodeId: toId,
          toNodeType: rel.toType,
          type: relType,
          isBidirectional: rel.bidirectional ?? false,
        });
      } catch (err) {
        this.logger.warn('Failed to upsert relationship', {
          userId,
          fromName: rel.fromName,
          toName: rel.toName,
          type: relType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ------------------------------------------------------------------
    // 4. Mark fragments as processed
    // ------------------------------------------------------------------

    await this.agentMemoryService.markProcessed(
      { userId: SYSTEM_USER } as ServiceContext,
      fragments.map((f) => f.id),
    );

    this.logger.log('Memory compaction complete', {
      userId,
      fragmentCount: fragments.length,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Dispatches to the appropriate per-type domain service so its `*.created`
   * event fires (and downstream indexers pick the row up). Returns the
   * resulting entity id, or null if this type can't be persisted from the
   * limited info the LLM emits.
   *
   * person / concept : search-by-name; reuse existing id if matched, else create.
   * place / item     : always create a new row (no name-based dedup yet).
   * event / content  : no-op for now (see TODOs below).
   */
  private async upsertEntity(
    context: UserServiceContext,
    type: string,
    name: string,
    description: string | null,
  ): Promise<string | null> {
    switch (type) {
      case 'person': {
        const matches = await this.personService.search(context, { name });
        const existing = matches.find((p) => p.name?.toLowerCase() === name.toLowerCase());

        if (existing) {
          return existing.id;
        }

        const created = await this.personService.create(context, {
          name,
          description: description ?? undefined,
        });

        return created.id;
      }

      case 'concept': {
        const matches = await this.conceptService.search(context, { name });
        const existing = matches.find((c) => c.name?.toLowerCase() === name.toLowerCase());

        if (existing) {
          return existing.id;
        }

        const created = await this.conceptService.create(context, {
          name,
          description: description ?? undefined,
        });

        return created.id;
      }

      case 'place': {
        const [created] = await this.placeService.create(context, {
          name,
          description: description ?? undefined,
        });

        return created?.id ?? null;
      }

      case 'item': {
        const created = await this.itemService.create(context, {
          name,
          description: description ?? undefined,
        });

        return created.id;
      }

      // TODO: EventService.create requires `title` and a real `start_time: Date`,
      // neither of which the extraction prompt asks for. Either extend the LLM
      // output schema to include those fields, or route events through a
      // separate extraction path.
      case 'event':
        this.logger.debug('Skipping event entity: extraction prompt does not yield start_time', {
          name,
        });

        return null;

      // TODO: ContentService.create requires a `type` subkind (book / film /
      // article / …) that the extraction prompt does not produce. Extend the
      // LLM schema before enabling this branch.
      case 'content':
        this.logger.debug('Skipping content entity: extraction prompt does not yield content type', {
          name,
        });

        return null;

      default:
        return null;
    }
  }

  private entityKey(type: string, name: string): string {
    return `${(type ?? '').toLowerCase()}:${(name ?? '').toLowerCase()}`;
  }

  private parseExtractionResult(content: string): ExtractionResult {
    const empty: ExtractionResult = { entities: [], relationships: [] };

    let text = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const brace = text.indexOf('{');
    if (brace > 0) {
      text = text.slice(brace);
    }

    if (!text.endsWith('}')) {
      this.logger.warn('LLM result appears truncated; skipping', {
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
