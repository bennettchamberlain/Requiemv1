# DocumentChunkerService.ts

## Purpose
Converts normalized parser output into persisted chunk DTOs. It owns chunk sizing and overlap behavior but stays parser-agnostic by consuming `ParsedDocument`.

## Components

### `chunkDocument`
- **Does**: Flattens parsed sections into chunk DTOs and preserves parser/provenance metadata
- **Interacts with**: `DocumentChunkService.ts`, `FileDocumentParseListener.ts`

### `splitWithOverlap` / `hardSplit`
- **Does**: Breaks oversized sections into overlapping windows with paragraph-first splitting
- **Interacts with**: chunk sizing constants in `../types.ts`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `DocumentChunkService.ts` | Each chunk DTO has stable indices and provenance fields | Removing `chunkIndex` or parser metadata |
| Search indexing | Chunk text is already normalized and size-bounded | Emitting arbitrarily large chunks |
