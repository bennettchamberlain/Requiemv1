# FileDocumentParseListener.ts

## Purpose
Queue-backed upload listener that turns stored files into searchable chunks. It validates parseability, retrieves object bytes, invokes parsing, persists chunks, updates file parse state, and emits indexing work.

## Components

### `parseDocument`
- **Does**: Handles `FileUploadedEvent` end-to-end for supported files
- **Interacts with**: `FileService`, `DocumentParserService`, `DocumentChunkerService`, `DocumentChunkService`, `DocumentParsedEvent`

### `updateParseStatus`
- **Does**: Writes parse lifecycle fields back to `ci.files`
- **Interacts with**: `ParseStatus` in `../types.ts`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| File detail queries | `parse_status`, `parse_error`, and parser metadata stay in sync with parsing outcomes | Changing when file state is updated |
| Search indexing listener | `DocumentParsedEvent` fires only after chunks are persisted | Emitting before persistence completes |
