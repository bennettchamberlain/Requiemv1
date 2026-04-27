# GlobalUID.ts

## Purpose
Encodes and decodes globally unique GraphQL node identifiers. It is the shared contract that lets search results, node lookups, and unions agree on resource identity across domains.

## Components

### `GlobalUID.encode`
- **Does**: Produces base64 `type:id` global identifiers
- **Interacts with**: GraphQL object types such as `FileType.ts` and `FileChunkType.ts`

### `GlobalUID.decode` / `parse`
- **Does**: Recovers the resource type and raw ID for resolver dispatch
- **Interacts with**: `NodeResolver.ts`, `SearchResultType.ts`

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `NodeResolver.ts` | Resource type strings are stable and exhaustive enough for node dispatch | Removing a type or changing its string form |
| Search unions | Encoded IDs round-trip cleanly through `decode()` | Altering the `type:id` wire format |
