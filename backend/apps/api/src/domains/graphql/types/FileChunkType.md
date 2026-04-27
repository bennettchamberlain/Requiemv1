# FileChunkType.ts

## Purpose
GraphQL node type for document chunks indexed from uploaded files. It exposes the extracted text plus enough provenance to attribute a search hit back to its parent file.

## Components

### `FileChunkType`
- **Does**: Represents a persisted `ci.file_chunks` row in GraphQL search and node lookups
- **Interacts with**: `SearchResolver.ts`, `NodeResolver.ts`, `SearchResultType.ts`

### `FileChunkType.toType`
- **Does**: Adapts a chunk entity and optional parent file into a GraphQL-safe object
- **Interacts with**: `FileType.ts`, `GlobalUID.ts`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Search clients | `fileId`, `sectionTitle`, and `sourceLocator` are available for attribution | Removing provenance fields |
| `SearchResultType.ts` | IDs encode as `file-chunk` global node IDs | Changing the encoded resource type |
