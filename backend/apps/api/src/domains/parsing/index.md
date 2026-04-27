# index.ts

## Purpose
Nest module entrypoint for the parsing domain. It wires parser selection, chunk persistence, and the async file-upload listener into one backend module and exposes the chunk service to downstream search consumers.

## Components

### `ParsingModule`
- **Does**: Registers parsing providers and the `DOCUMENT_EXTRACTORS` collection
- **Interacts with**: `FilesModule`, `EventsModule`, search listeners that import `FileChunkService`

### Re-exports
- **Does**: Publishes chunk entities, chunk service aliases, parse events, and parse status values
- **Interacts with**: `SearchResolver`, `NodeResolver`, `DatabaseSearchTool`, `FileChunkSearchIndexListener`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `@ci/domains/search-ingress` | `FileChunkService` export remains available | Removing or renaming the exported alias |
| `@ci/domains/graphql` | Parsing module provides chunk lookup services | Removing providers required by search/node resolution |
