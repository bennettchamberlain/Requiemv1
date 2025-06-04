import type { Params } from '@feathersjs/feathers';
import { KnexService } from '@feathersjs/knex';
import { validateData } from '@feathersjs/schema';
import { Type, Static, getValidator } from '@feathersjs/typebox';
import type { Knex } from 'knex';
import ollama from 'ollama';

import { Application } from '../configuration/types';
import { queryValidator } from '../configuration/validators';
import { hideFromExternal } from '../hooks';

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

export const EmbeddingsInput = Type.Object(
  {
    input: Type.String(),
  },
  {
    additionalProperties: false,
  },
);

export type EmbeddingsInputType = Static<typeof EmbeddingsInput>;

const validator = getValidator(EmbeddingsInput, queryValidator);

export class EmbeddingsService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  async create(input: EmbeddingsInputType) {
    const internalEmbeddingsService = this.app.service('internalEmbeddings');

    const response = await ollama.embeddings({
      model: EMBEDDING_MODEL,
      prompt: input.input,
    });

    const vector = response.embedding;

    await internalEmbeddingsService.create({
      model: EMBEDDING_MODEL,
      raw_input: input.input,
      embedding_vector: `[${vector.join(',')}]`,
    });

    return true;
  }

  static hooks = {
    before: {
      create: [validateData(validator)],
    },
  };
}

export type Embedding = {
  id: bigint;
  model: string;
  raw_input: string;
  embedding_vector: string;
  created_at: string;
  updated_at: string;
};

export class InternalEmbeddingsService extends KnexService<Embedding> {
  constructor(db: Knex) {
    super({
      Model: db,
      name: 'embeddings',
      id: 'id',
    });
  }

  async create(data: Partial<Embedding>, params?: Params): Promise<Embedding>;
  async create(data: Partial<Embedding>[], params?: Params): Promise<Embedding[]>;
  async create(
    data: Partial<Embedding> | Partial<Embedding>[],
    params?: Params,
  ): Promise<Embedding | Embedding[]> {
    return super.create(data, params);
  }

  static hooks = {
    before: {
      create: [hideFromExternal],
    },
  };
}
