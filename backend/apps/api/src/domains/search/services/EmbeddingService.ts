import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ollama from 'ollama';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { EmbeddingEntity } from '../entities/EmbeddingEntity';

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

@Injectable()
export class EmbeddingService {
  constructor(
    @InjectRepository(EmbeddingEntity)
    private embeddingRepo: Repository<EmbeddingEntity>,
  ) {}

  async calculateEmbedding(input: string) {
    const vector = await this.calculateVector(input);

    await this.embeddingRepo.save({
      id: uuidv7(),
      model: EMBEDDING_MODEL,
      raw_input: input,
      embedding_vector: vector,
    });

    return vector;
  }

  async findAll(): Promise<EmbeddingEntity[]> {
    return this.embeddingRepo.find();
  }

  async findNearest(input: string, topK: number = 5): Promise<EmbeddingEntity[]> {
    const vector = await this.calculateVectorString(input);

    return this.embeddingRepo.query(
      `SELECT *, embedding_vector <-> $1 as distance FROM embeddings ORDER BY distance ASC LIMIT $2`,
      [vector, topK],
    );
  }

  private async calculateVector(input: string) {
    const response = await ollama.embeddings({
      model: EMBEDDING_MODEL,
      prompt: input,
    });

    return response.embedding;
  }

  private async calculateVectorString(input: string) {
    const vector = await this.calculateVector(input);

    return `[${vector.join(',')}]`
  }
}
