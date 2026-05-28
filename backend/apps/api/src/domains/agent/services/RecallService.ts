import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EntityResolutionService, type ResolvedEntity } from '@ci/domains/entity-resolution';
import { SearchService } from '@ci/domains/search-next';

import type { RecallDto, RecallResult } from '../types';

import { SerializerService, type AnyHydratedResult } from './SerializerService';

const DEFAULT_MAX_RESULTS = 5;

/**
 * L1 — per-turn keyword/semantic search against the knowledge graph.
 *
 * Runs SearchService in 'auto' mode (keyword for short queries, boosted for
 * medium, semantic for long), resolves the returned identifiers into full
 * domain entities via EntityResolutionService, then serialises everything into
 * compact single-line strings via SerializerService.
 */
@Injectable()
export class RecallService {
  constructor(
    private readonly searchService: SearchService,
    private readonly entityResolution: EntityResolutionService,
    private readonly serializer: SerializerService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(RecallService.name);
  }

  async recall(context: UserServiceContext, dto: RecallDto): Promise<RecallResult> {
    const maxResults = dto.maxResults ?? DEFAULT_MAX_RESULTS;
    const query = this.sanitizeQuery(dto.query);

    if (!query) {
      return { block: '', resultCount: 0 };
    }

    try {
      const results = await this.searchService.search(context, {
        query,
        mode: 'auto',
        maxResults,
      });

      if (results.length === 0) {
        return { block: '', resultCount: 0 };
      }

      const resolved = await this.entityResolution.resolve(context, results);

      const lines: string[] = [];

      // Preserve the original search-score ordering.
      for (const { type, id } of results) {
        const hit = resolved.get(`${type}:${id}`);

        if (!hit) {
          continue;
        }

        const hydrated = this.toHydrated(hit);

        if (hydrated) {
          lines.push(this.serializer.serialize(hydrated));
        }
      }

      if (lines.length === 0) {
        return { block: '', resultCount: 0 };
      }

      const block = `## Relevant context\n${lines.join('\n')}`;

      return { block, resultCount: lines.length };
    } catch (err) {
      this.logger.warn(`Recall failed for user ${context.userId}: ${err}`);

      return { block: '', resultCount: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Map a ResolvedEntity (full domain object) to the slim AnyHydratedResult
   * shape that SerializerService expects.  Returns null for types that have
   * no serialisation (e.g. 'action').
   */
  private toHydrated(resolved: ResolvedEntity): AnyHydratedResult | null {
    const { type, id, entity } = resolved;

    switch (type) {
      // --- ci.entities (name / description / properties / searchContent) ---

      case 'person':
      case 'concept':
        return {
          id,
          type,
          name: entity.name ?? null,
          description: entity.description ?? null,
          properties: entity.properties ?? {},
          searchContent: entity.searchContent ?? null,
        };

      case 'place':
        return {
          id,
          type: 'place',
          name: entity.name ?? null,
          description: entity.description ?? null,
          properties: entity.properties ?? {},
          searchContent: null, // PlaceEntity has no searchContent column
        };

      // --- ci.events (title / description / startTime / eventType) ---

      case 'event':
        return {
          id,
          type: 'event',
          name: entity.title ?? null,
          description: entity.description ?? null,
          // Fold known date/type fields into properties so the serializer can
          // pick them up via its normal props['start_date'] lookup.
          properties: {
            start_date:
              entity.startTime instanceof Date ? entity.startTime.toISOString() : (entity.startTime ?? ''),
            type: entity.eventType ?? '',
          },
          searchContent: null,
        };

      // --- ci.inventory (name / description / condition) ---

      case 'item':
        return {
          id,
          type: 'item',
          name: entity.name ?? null,
          description: entity.description ?? null,
          properties: {
            condition: entity.condition ?? '',
          },
          searchContent: null,
        };

      // --- ci.content (title / text) ---

      case 'content':
        return {
          id,
          type: 'content',
          name: entity.title ?? null,
          description: null,
          properties: {},
          searchContent: entity.text ?? null,
        };

      // --- ci.communications ---

      case 'communication':
        return {
          id,
          type: 'communication',
          direction: entity.direction,
          content: entity.content,
          summary: entity.summary ?? null,
          // CommunicationEntity.time is a Date; serializer expects a string.
          time: entity.time instanceof Date ? entity.time.toISOString() : String(entity.time),
        };

      // --- ci.notes ---

      case 'note':
        return {
          id,
          type: 'note',
          title: entity.title ?? null,
          content: entity.content ?? null,
        };

      // --- ci.browser_activity ---

      case 'browser-activity':
        return {
          id,
          type: 'browser-activity',
          url: entity.url,
          title: entity.title ?? null,
        };

      // --- ci.files ---

      case 'file':
        return {
          id,
          type: 'file',
          filename: entity.filename ?? null,
          title: entity.title ?? null,
          description: entity.description ?? null,
          contentType: entity.contentType ?? null,
        };

      // --- ci.answers ---

      case 'answer':
        return {
          id,
          type: 'answer',
          answer: entity.answer,
        };

      // --- ci.threads ---

      case 'thread':
        return {
          id,
          type: 'thread',
          name: entity.name ?? null,
          // ThreadEntity maps the DB 'summary' column to the TS property 'description'.
          summary: entity.description ?? null,
        };

      default:
        // 'action' and any future types not yet serialised.
        return null;
    }
  }

  /**
   * Strips punctuation and normalises whitespace so the query works cleanly
   * with Postgres websearch_to_tsquery.
   *
   * NOT keyword extraction — stop-word removal and stemming are delegated
   * entirely to Postgres.
   */
  private sanitizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
