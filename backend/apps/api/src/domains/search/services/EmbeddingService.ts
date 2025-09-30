import crypto from 'crypto';

import { Injectable } from '@nestjs/common';
import dlv from 'dlv';
import { Ollama } from 'ollama';
import { DataSource } from 'typeorm';

import { getIndexableMetadata } from '@ci/common/decorators';
import type { RequestContext } from '@ci/common/types';
import config from '@ci/configuration';

// 768 dimension model, hard coded for now, but doesn't need to stay this way
// Note: We can consider downsampling by:
//
//   * Truncate: embedding.slice(0, 384)
//   * Pool: chunk & average
//   * PCA or UMAP (offline dimensionality reduction)
//
// All of these will reduce semantic accuracy and we'd to research and consider
// the tradeoffs.
const EMBEDDING_MODEL = 'nomic-embed-text';

interface Entity {
  id: string;
  user?: {
    id: string;
  };
}

export interface SearchResult {
  text: string;
  type: string;
  id: string;
  distance: number;
  user_id?: string;
}

// Map entity types to their table names and column configurations
const ENTITY_CONFIG: Record<
  string,
  {
    table: string;
    idColumn: string;
    textColumn: string;
    embeddingColumn: string;
    userColumn?: string;
  }
> = {
  question: {
    table: 'questions',
    idColumn: 'question_id',
    textColumn: 'question_text',
    embeddingColumn: 'question_embedding',
    userColumn: undefined, // questions are global, no user_id
  },
  answer: {
    table: 'answers',
    idColumn: 'answer_id',
    textColumn: 'answer_text',
    embeddingColumn: 'answer_embedding',
    userColumn: 'user_id',
  },
  // Note: 'content' table doesn't have embedding column yet - add when migrated
  // 'content': {
  //   table: 'content',
  //   idColumn: 'id',
  //   textColumn: 'text',
  //   embeddingColumn: 'content_embedding', // needs to be added to schema
  //   userColumn: 'user_id',
  // },
  // Add more entity types as needed: documents, messages, etc.
};

@Injectable()
export class EmbeddingService {
  private readonly ollama = new Ollama({
    host: config.services.ollama.host,
  });

  constructor(private readonly dataSource: DataSource) {}

  async indexText(context: RequestContext, input: string) {
    // Just calculate the vector without storing it anywhere
    return this.calculateVector(input);
  }

  async indexEntity(entity: Entity, dataPath: string): Promise<number[]> {
    const metadata = getIndexableMetadata(entity);

    if (!metadata) {
      throw new Error(`Entity is not indexable: ${entity.constructor.name}`);
    }

    const { type, validPaths } = metadata;

    if (!validPaths.has(dataPath)) {
      throw new Error(`Invalid data path: ${dataPath}`);
    }

    if (!type) {
      throw new Error(`Entity type is not defined for: ${entity.constructor.name}`);
    }

    const input = String(dlv(entity, dataPath) ?? '');

    // Calculate the embedding vector
    const vector = await this.calculateVector(input);

    // Get the entity configuration
    const config = ENTITY_CONFIG[type];
    if (!config) {
      throw new Error(`Unknown entity type: ${type}`);
    }

    // Write the embedding directly to the source table
    const vectorString = `[${vector.join(',')}]`;
    await this.dataSource.query(
      `UPDATE ${config.table} SET ${config.embeddingColumn} = $1 WHERE ${config.idColumn} = $2`,
      [vectorString, entity.id],
    );

    return vector;
  }

  async findAll(context: RequestContext): Promise<SearchResult[]> {
    // Return all entities with embeddings for this user
    // This searches across all entity types
    return this.findNearest(context, '', undefined, 1000); // Large limit to get "all"
  }

  async findNearest(
    context: RequestContext,
    input: string,
    types?: string[],
    topK: number = 25,
  ): Promise<SearchResult[]> {
    const vector = await this.calculateVectorString(input);

    // Determine which entity types to search
    // Handle cases where types might be undefined, null, or not an array
    const searchTypes =
      Array.isArray(types) && types.length > 0
        ? types.filter((t) => ENTITY_CONFIG[t])
        : Object.keys(ENTITY_CONFIG);

    if (searchTypes.length === 0) {
      return [];
    }

    // Build UNION query across all entity types
    const unionQueries: string[] = [];
    const params: (string | number)[] = [vector];
    let paramIndex = 2;

    for (const type of searchTypes) {
      const config = ENTITY_CONFIG[type];

      let selectClause = `
        SELECT 
          '${type}' as type,
          ${config.idColumn} as id,
          ${config.textColumn} as text,
          ${config.embeddingColumn} <-> $1 as distance
      `;

      if (config.userColumn) {
        selectClause += `, ${config.userColumn} as user_id`;
      } else {
        selectClause += `, NULL as user_id`;
      }

      selectClause += ` FROM ${config.table}`;

      // Add WHERE clauses
      const whereClauses: string[] = [];

      // Check that embedding exists
      whereClauses.push(`${config.embeddingColumn} IS NOT NULL`);

      // Add user filtering if applicable
      if (context.userId && config.userColumn) {
        whereClauses.push(`${config.userColumn} = $${paramIndex}`);
        params.push(context.userId);
        paramIndex++;
      }

      if (whereClauses.length > 0) {
        selectClause += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      unionQueries.push(selectClause);
    }

    // Combine all queries with UNION ALL
    let sql = unionQueries.join(' UNION ALL ');

    // Order by distance and limit
    sql += ` ORDER BY distance ASC LIMIT $${paramIndex}`;
    params.push(topK);

    const results = await this.dataSource.query(sql, params);

    return results.map(
      (row: { type: string; id: string; text: string; distance: string; user_id?: string }) => ({
        type: row.type,
        id: row.id,
        text: row.text,
        distance: parseFloat(row.distance),
        user_id: row.user_id,
      }),
    );
  }

  private async sha256(input: string) {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  private async calculateVector(input: string): Promise<number[]> {
    const response = await this.ollama.embeddings({
      model: EMBEDDING_MODEL,
      prompt: input,
    });

    return response.embedding;
  }

  private async calculateVectorString(input: string): Promise<string> {
    const vector = await this.calculateVector(input);

    return `[${vector.join(',')}]`;
  }
}
