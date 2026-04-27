# SearchResultType.ts

## Purpose
Defines the GraphQL union returned from global search. It is the schema-level list of entity types the backend is willing to surface as search hits.

## Components

### `SearchResultType`
- **Does**: Enumerates search result node types and resolves them from global IDs
- **Interacts with**: `SearchResolver.ts`, `GlobalUID.ts`, all concrete GraphQL node types

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `SearchResolver.ts` | Every returned result type is present in the union | Returning a node type not listed here |
| GraphQL clients | `resolveType` matches the global ID encoding | Changing union member names or decode rules |
