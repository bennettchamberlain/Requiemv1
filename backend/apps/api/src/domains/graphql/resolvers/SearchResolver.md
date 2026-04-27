# SearchResolver.ts

## Purpose
Implements the GraphQL search entrypoint. It routes query-, tag-, and time-based search modes through shared resolution logic and hydrates raw search identifiers into concrete GraphQL node types.

## Components

### `search`
- **Does**: Validates search input, chooses the search mode, and paginates results
- **Interacts with**: `SearchService`, `TagService`, `SearchResultConnection`

### `resolveEntities`
- **Does**: Groups raw search hits by entity type and hydrates them into GraphQL objects, including file chunks and their parent files
- **Interacts with**: domain services across files, parsing, memory, notes, intelligence, and conversations

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| GraphQL clients | Search hits preserve backend ranking order and hydrate into concrete node types | Reordering or dropping hydrated results |
| Search indexing | New indexed entity types are wired through here before becoming user-visible | Adding an indexable type without resolver support |
