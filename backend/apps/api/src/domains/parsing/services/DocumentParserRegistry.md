# DocumentParserRegistry.ts

## Purpose
Central parser-selection logic for the parsing domain. It hides extractor ordering and autodetection behind one registry so upload listeners and orchestration code do not need per-format branching.

## Components

### `DocumentParserRegistry`
- **Does**: Answers “can we parse this?” and resolves the concrete extractor for a file target
- **Interacts with**: `DocumentParserService.ts`, `DocumentExtractor.ts`, registered extractors such as `MarkItDownExtractor.ts`
- **Rationale**: Keeps future parser additions localized to registration instead of spreading MIME checks through listeners

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `DocumentParserService.ts` | `resolve()` returns `null` when nothing matches | Throwing instead of returning `null` |
| `FileDocumentParseListener.ts` | `supports()` is the source of truth for parseability | Reintroducing hardcoded MIME checks elsewhere |
