import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { SearchService } from '@ci/domains/search-next';

import type { RecallDto, RecallResult } from '../types';

import {
  SerializerService,
  type AnyHydratedResult,
  type HydratedAnswer,
  type HydratedBrowserActivity,
  type HydratedCommunication,
  type HydratedFile,
  type HydratedGraphEntity,
  type HydratedNote,
  type HydratedThread,
} from './SerializerService';

const DEFAULT_MAX_RESULTS = 5;

/** Entity types that live in ci.entities (as opposed to their own tables). */
const GRAPH_ENTITY_TYPES = new Set(['person', 'concept', 'event', 'place', 'item', 'content']);

/**
 * L1 — per-turn keyword/semantic search against the knowledge graph.
 *
 * Runs SearchService in 'auto' mode (keyword for short queries, boosted for
 * medium, semantic for long), hydrates the returned IDs from their source
 * tables, then serialises everything into compact single-line strings via
 * SerializerService before returning a Markdown context block.
 */
@Injectable()
export class RecallService {
  constructor(
    private readonly searchService: SearchService,
    private readonly serializer: SerializerService,
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

      // Bucket search results by their source table.
      const entityIds = results.filter((r) => GRAPH_ENTITY_TYPES.has(r.type)).map((r) => r.id);
      const communicationIds = results.filter((r) => r.type === 'communication').map((r) => r.id);
      const noteIds = results.filter((r) => r.type === 'note').map((r) => r.id);
      const browserActivityIds = results.filter((r) => r.type === 'browser-activity').map((r) => r.id);
      const fileIds = results.filter((r) => r.type === 'file').map((r) => r.id);
      const answerIds = results.filter((r) => r.type === 'answer').map((r) => r.id);
      const threadIds = results.filter((r) => r.type === 'thread').map((r) => r.id);

      const [entities, communications, notes, browserActivities, files, answers, threads] = await Promise.all(
        [
          this.hydrateEntities(entityIds, context.userId),
          this.hydrateCommunications(communicationIds, context.userId),
          this.hydrateNotes(noteIds, context.userId),
          this.hydrateBrowserActivity(browserActivityIds, context.userId),
          this.hydrateFiles(fileIds, context.userId),
          this.hydrateAnswers(answerIds, context.userId),
          this.hydrateThreads(threadIds, context.userId),
        ],
      );

      const hydrated: AnyHydratedResult[] = [
        ...entities,
        ...communications,
        ...notes,
        ...browserActivities,
        ...files,
        ...answers,
        ...threads,
      ];

      if (hydrated.length === 0) {
        return { block: '', resultCount: 0 };
      }

      const lines = hydrated.map((r) => this.serializer.serialize(r));
      const block = `## Relevant context\n${lines.join('\n')}`;

      return { block, resultCount: hydrated.length };
    } catch (err) {
      this.logger.warn(`Recall failed for user ${context.userId}: ${err}`);

      return { block: '', resultCount: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Private hydration helpers — each queries a single source table
  // ---------------------------------------------------------------------------

  private async hydrateEntities(ids: string[], userId: string): Promise<HydratedGraphEntity[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      entity_id: string;
      entity_type: string;
      name: string | null;
      description: string | null;
      properties: Record<string, unknown>;
      search_content: string | null;
    }> = await this.dataSource.query(
      `SELECT entity_id, entity_type, name, description, properties, search_content
       FROM ci.entities
       WHERE entity_id = ANY($1)
         AND owner_user_id = $2
         AND is_active = TRUE`,
      [ids, userId],
    );

    return rows.map((row) => ({
      id: row.entity_id,
      type: row.entity_type as HydratedGraphEntity['type'],
      name: row.name,
      description: row.description,
      properties: row.properties ?? {},
      searchContent: row.search_content,
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

  private async hydrateNotes(ids: string[], userId: string): Promise<HydratedNote[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      id: string;
      title: string | null;
      content: string | null;
    }> = await this.dataSource.query(
      `SELECT id, title, content
       FROM ci.notes
       WHERE id = ANY($1)
         AND user_id = $2`,
      [ids, userId],
    );

    return rows.map((row) => ({
      id: row.id,
      type: 'note' as const,
      title: row.title,
      content: row.content,
    }));
  }

  private async hydrateBrowserActivity(ids: string[], userId: string): Promise<HydratedBrowserActivity[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      id: string;
      url: string;
      title: string | null;
    }> = await this.dataSource.query(
      `SELECT id, url, title
       FROM ci.browser_activity
       WHERE id = ANY($1)
         AND user_id = $2`,
      [ids, userId],
    );

    return rows.map((row) => ({
      id: row.id,
      type: 'browser-activity' as const,
      url: row.url,
      title: row.title,
    }));
  }

  private async hydrateFiles(ids: string[], userId: string): Promise<HydratedFile[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      id: string;
      filename: string | null;
      title: string | null;
      description: string | null;
      content_type: string | null;
    }> = await this.dataSource.query(
      `SELECT id, filename, title, description, content_type
       FROM ci.files
       WHERE id = ANY($1)
         AND user_id = $2
         AND deleted_at IS NULL`,
      [ids, userId],
    );

    return rows.map((row) => ({
      id: row.id,
      type: 'file' as const,
      filename: row.filename,
      title: row.title,
      description: row.description,
      contentType: row.content_type,
    }));
  }

  private async hydrateAnswers(ids: string[], userId: string): Promise<HydratedAnswer[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      id: string;
      answer: string;
    }> = await this.dataSource.query(
      `SELECT answer_id AS id, answer_text AS answer
       FROM ci.answers
       WHERE answer_id = ANY($1)
         AND user_id = $2`,
      [ids, userId],
    );

    return rows.map((row) => ({
      id: row.id,
      type: 'answer' as const,
      answer: row.answer,
    }));
  }

  private async hydrateThreads(ids: string[], userId: string): Promise<HydratedThread[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      id: string;
      name: string | null;
      summary: string | null;
    }> = await this.dataSource.query(
      `SELECT thread_id AS id, title AS name, summary
       FROM ci.threads
       WHERE thread_id = ANY($1)
         AND user_id = $2`,
      [ids, userId],
    );

    return rows.map((row) => ({
      id: row.id,
      type: 'thread' as const,
      name: row.name,
      summary: row.summary,
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
