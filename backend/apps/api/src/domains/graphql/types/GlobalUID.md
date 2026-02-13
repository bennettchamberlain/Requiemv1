# GlobalUID.ts

## Purpose
Provides global ID encoding/decoding helpers used across GraphQL node types.

## Components

### `ResourceType`
- **Does**: Enumerates valid global ID resource prefixes.

### `GlobalUID.encode`
- **Does**: Encodes `type:id` as base64.

### `GlobalUID.decode`
- **Does**: Decodes and validates base64 global IDs.

### `GlobalUID.parse`
- **Does**: Ensures decoded type matches expected resource type and returns raw ID.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| GraphQL resolvers/types | Stable resource type labels | Removing/changing type labels |

## Notes
- `fact` resource type was removed when fact GraphQL types/resolvers were deleted.
