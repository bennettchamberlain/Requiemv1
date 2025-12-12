export type EmbeddableEntityType = 'person';

export interface UpsertEmbeddingDto {
  entityType: EmbeddableEntityType;
  entityId: string;
  embedding: number[];
}

export interface UpsertVectorDto {
  entityType: EmbeddableEntityType;
  entityId: string;
  searchableText: string[];
}

export interface RemoveEmbeddingDto {
  entityType: EmbeddableEntityType;
  entityId: string;
}

export interface RemoveVectorDto {
  entityType: EmbeddableEntityType;
  entityId: string;
}
