import type { Params, HookContext } from '@feathersjs/feathers';
import { validateData } from '@feathersjs/schema';
import { Type, Static, getValidator } from '@feathersjs/typebox';
import { authenticate } from '@feathersjs/authentication';
import { iff } from 'feathers-hooks-common';
import ollama from 'ollama';

import { Application } from '../configuration/types';
import { queryValidator } from '../configuration/validators';

export const SearchQuery = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
  },
  {
    additionalProperties: false,
  },
);

export type SearchQueryType = Static<typeof SearchQuery>;

export const SearchResult = Type.Object({
  id: Type.Number(),
  source_id: Type.String({ format: 'uuid' }),
  source_label: Type.String(),
  distance: Type.Number(),
  raw_input: Type.Optional(Type.String()),
});

export type SearchResultType = Static<typeof SearchResult>;

const validator = getValidator(SearchQuery, queryValidator);

export class SearchService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  async find(params: Params): Promise<SearchResultType[]> {
    // Extract query parameters
    const { query, limit = 10 } = params.query || {};

    if (!query) {
      throw new Error('Query parameter is required');
    }

    try {
      // Generate embedding for the search query
      const response = await ollama.embeddings({
        model: 'nomic-embed-text',
        prompt: query,
      });

      // Format embedding as PostgreSQL vector string
      const vectorString = `[${response.embedding.join(',')}]`;

      // Get the database client
      const db = this.app.get('postgresqlClient');

      // Perform the similarity search
      const sql = `
        SELECT 
          id,
          source_id,
          source_label,
          raw_input,
          embedding_vector <-> $1::vector AS distance 
        FROM embeddings 
        ORDER BY distance ASC 
        LIMIT $2
      `;

      const result = await db.raw(sql, [vectorString, limit]);

      // Return the search results
      return result.rows.map((row: any) => ({
        id: row.id,
        source_id: row.source_id,
        source_label: row.source_label,
        distance: parseFloat(row.distance),
        raw_input: row.raw_input,
      }));
    } catch (error) {
      console.error('Error performing semantic search:', error);
      throw new Error('Failed to perform search');
    }
  }

  async get(id: string, params: Params) {
    throw new Error('Method not implemented');
  }

  async create(data: any, params: Params) {
    throw new Error('Method not implemented');
  }

  async update(id: string, data: any, params: Params) {
    throw new Error('Method not implemented');
  }

  async patch(id: string, data: any, params: Params) {
    throw new Error('Method not implemented');
  }

  async remove(id: string, params: Params) {
    throw new Error('Method not implemented');
  }

  static hooks = {
    before: {
      all: [
        // Only authenticate if it's an external request
        iff((context: HookContext) => context.params.provider, authenticate('jwt')),
      ],
      find: [
        async (context: HookContext) => {
          // Validate query parameters
          const { query } = context.params;
          if (query) {
            await validateData(validator)(query);
          }
          return context;
        },
      ],
    },
  };
}
