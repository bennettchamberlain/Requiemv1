import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EntityResolutionService } from '@ci/domains/entity-resolution';
import { SearchService } from '@ci/domains/search-next';

import type { RecallDto, RecallResult } from '../types';

import { SerializerService } from './SerializerService';

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

        const line = this.serializer.serialize(hit);

        if (line) {
          lines.push(line);
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
