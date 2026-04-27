# MarkItDownExtractor.ts

## Purpose
Concrete extractor for the current document parsing pipeline. It handles common office/text formats and delegates extraction to the external parser service while conforming to the generic extractor interface.

## Components

### `SUPPORTED_MIME_TYPES` / `SUPPORTED_EXTENSIONS`
- **Does**: Declare current autodetection rules for MarkItDown-backed parsing
- **Interacts with**: `DocumentParserRegistry.ts`

### `MarkItDownExtractor`
- **Does**: Detects supported files and POSTs them to the parser service
- **Interacts with**: `DocumentParserService.ts`, parser-service configured via `@ci/configuration`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `DocumentParserRegistry.ts` | `supports()` matches what `parse()` can actually handle | Broadening detection without parser support |
| `FileDocumentParseListener.ts` | Parse failures surface as thrown errors | Swallowing failures instead of propagating them |
