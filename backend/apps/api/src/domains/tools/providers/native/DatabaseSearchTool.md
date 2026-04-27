# DatabaseSearchTool.ts

## Purpose
Native tool that exposes hybrid search to internal agents and LLM-driven workflows. It wraps `SearchService`, then hydrates search hits into concrete backend entities that tools can inspect directly.

## Components

### `DatabaseSearchTool`
- **Does**: Validates tool input, executes search, and returns resolved entities
- **Interacts with**: `SearchService`, domain services across files, parsing, memory, conversations, and intelligence

### `resolveEntities`
- **Does**: Rehydrates raw search IDs into domain objects, including `FileChunk` results
- **Interacts with**: `INDEXABLE_ENTITIES` in `@ci/domains/search-next`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Tool callers | Search results reflect the same entity coverage as backend indexing | Dropping an indexed entity type here |
| `SearchService` | Result ordering is preserved after hydration | Re-sorting or filtering resolved results unexpectedly |
