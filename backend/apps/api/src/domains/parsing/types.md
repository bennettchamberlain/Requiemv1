# types.ts

## Purpose
Shared parsing-domain contracts: parse status values, chunk sizing knobs, parser output types, and chunk persistence DTOs. This file stays free of transport and storage logic so the rest of the parsing pipeline can share one vocabulary.

## Components

### `ParseStatus`
- **Does**: Defines terminal and in-flight parse states stored on `ci.files`
- **Interacts with**: `FileDocumentParseListener` in `listeners/FileDocumentParseListener.ts`, `FileType` in `../graphql/types/FileType.ts`

### `ParsedDocument` / `ParsedSection`
- **Does**: Normalized parser output consumed by chunking and indexing
- **Interacts with**: `DocumentParserService` in `services/DocumentParserService.ts`, `DocumentChunkerService` in `services/DocumentChunkerService.ts`

### `CreateChunkDto`
- **Does**: Internal shape used when persisting extracted chunks
- **Interacts with**: `DocumentChunkService` in `services/DocumentChunkService.ts`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `DocumentChunkerService.ts` | Stable chunk sizing constants and parser output fields | Renaming `ParsedDocument` fields or removing chunk constants |
| `FileDocumentParseListener.ts` | `ParseStatus` values match persisted file state | Removing or renaming parse states |
