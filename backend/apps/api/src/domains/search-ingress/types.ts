export type EmbeddableEntityType = 'person';

export interface CreateEmbeddingDto {
  entityType: EmbeddableEntityType;
  entityId: string;
  embedding: number[];
}
