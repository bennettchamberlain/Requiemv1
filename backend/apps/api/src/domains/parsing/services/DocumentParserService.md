# DocumentParserService.ts

## Purpose
Orchestrates document parsing at the service boundary used by listeners. It delegates file autodetection to the registry and invokes the selected extractor without exposing extractor details to callers.

## Components

### `DocumentParserService`
- **Does**: Checks parseability and dispatches parse requests to a resolved extractor
- **Interacts with**: `DocumentParserRegistry.ts`, `FileDocumentParseListener.ts`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `FileDocumentParseListener.ts` | `canParse()` is the canonical parseability check | Removing `canParse()` or changing its semantics |
| Extractors | `parse()` receives the original bytes, MIME type, and filename | Mutating the request shape |
