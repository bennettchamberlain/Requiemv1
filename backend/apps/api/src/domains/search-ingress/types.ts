export type EmbeddableEntityType = 'person';

export interface CreateEmbeddingDto {
  entityType: EmbeddableEntityType;
  entityId: string;
  embedding: number[];
}

export interface CreateVectorDto {
  entityType: EmbeddableEntityType;
  entityId: string;
  searchableText: string[];
}
