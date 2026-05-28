import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { SearchService } from '@ci/domains/search-next';

import type { RecallDto, RecallResult } from '../types';

const DEFAULT_MAX_RESULTS = 5;

// ---------------------------------------------------------------------------
// Hydration result shapes
// ---------------------------------------------------------------------------

type HydratedEntity = {
  id: string;
  type: string;
  name: string | null;
  description: string | null;
};

type HydratedCommunication = {
  id: string;
  type: 'communication';
  direction: string;
  content: string;
  summary: string | null;
  time: string;
};

type HydratedResult = HydratedEntity | HydratedCommunication;

/**
 * L1 — per-turn keyword/semantic search against the knowledge graph.
 *
 * Runs SearchService in 'auto' mode (keyword for short queries, boosted for
 * medium, semantic for long), then hydrates the returned entity IDs into
 * readable names/descriptions from ci.entities and ci.communications.
 *
 * Serialisation is intentionally minimal for now (JSON) — a richer
 * sentence-based format is a future improvement.
 */
@Injectable()
export class RecallService {
  constructor(
    private readonly searchService: SearchService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

      const communicationIds = results.filter((r) => r.type === 'communication').map((r) => r.id);
      const entityIds = results.filter((r) => r.type !== 'communication').map((r) => r.id);

      const [entities, communications] = await Promise.all([
        this.hydrateEntities(entityIds, context.userId),
        this.hydrateCommunications(communicationIds, context.userId),
      ]);

      const hydrated: HydratedResult[] = [...entities, ...communications];

      if (hydrated.length === 0) {
        return { block: '', resultCount: 0 };
      }

      // TODO: replace with human-readable sentence serialisation
      const block = `## Relevant context\n${JSON.stringify(hydrated, null, 2)}`;

      return { block, resultCount: hydrated.length };
    } catch (err) {
      this.logger.warn(`Recall failed for user ${context.userId}: ${err}`);

      return { block: '', resultCount: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async hydrateEntities(ids: string[], userId: string): Promise<HydratedEntity[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      entity_id: string;
      entity_type: string;
      name: string | null;
      description: string | null;
    }> = await this.dataSource.query(
      `SELECT entity_id, entity_type, name, description
       FROM ci.entities
       WHERE entity_id = ANY($1)
         AND owner_user_id = $2
         AND is_active = TRUE`,
      [ids, userId],
    );

    return rows.map((row) => ({
      id: row.entity_id,
      type: row.entity_type,
      name: row.name,
      description: row.description,
    }));
  }

  private async hydrateCommunications(ids: string[], userId: string): Promise<HydratedCommunication[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      id: string;
      direction: string;
      content: string;
      summary: string | null;
      time: string;
    }> = await this.dataSource.query(
      `SELECT id, direction, content, summary, time
       FROM ci.communications
       WHERE id = ANY($1)
         AND user_id = $2`,
      [ids, userId],
    );

    return rows.map((row) => ({
      id: row.id,
      type: 'communication' as const,
      direction: row.direction,
      content: row.content,
      summary: row.summary,
      time: row.time,
    }));
  }

  /**
   * Strips punctuation and normalises whitespace so the query works cleanly
   * with Postgres websearch_to_tsquery.
   *
   * This is NOT keyword extraction — stop-word removal and stemming are
   * delegated entirely to Postgres. A future improvement would extract named
   * entities / noun phrases here before handing off to search.
   */
  private sanitizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
