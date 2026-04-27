# DocumentExtractor.ts

## Purpose
Defines the extensibility seam for document parsing. Extractors advertise whether they can handle a file target and return normalized `ParsedDocument` output when selected.

## Components

### `DOCUMENT_EXTRACTORS`
- **Does**: Injection token for the registered extractor list
- **Interacts with**: `ParsingModule` in `../index.ts`, `DocumentParserRegistry` in `DocumentParserRegistry.ts`

### `DocumentParseTarget` / `DocumentParseRequest`
- **Does**: Separates lightweight detection input from full parse input with bytes
- **Interacts with**: `DocumentParserService.ts`, `MarkItDownExtractor.ts`

### `DocumentExtractor`
- **Does**: Interface for future parser implementations
- **Interacts with**: `DocumentParserRegistry.ts`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `DocumentParserRegistry.ts` | `supports()` is cheap and side-effect free | Changing detection semantics |
| Future extractors | `parse()` returns normalized `ParsedDocument` | Returning parser-specific payloads |
