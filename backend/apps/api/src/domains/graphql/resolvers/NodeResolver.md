# NodeResolver.ts

## Purpose
Implements the GraphQL `node(id)` entrypoint. It dispatches a global ID to the owning domain service and returns the corresponding GraphQL node object.

## Components

### `node`
- **Does**: Decodes the global ID, fetches the domain entity, and adapts it into the matching GraphQL type
- **Interacts with**: `GlobalUID.ts`, domain services across files, parsing, memory, conversations, and auth/user domains

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| GraphQL clients | Any node ID returned from search can be looked up again via `node(id)` | Returning node IDs that are not resolvable here |
| GraphQL types | The resolver switches on the same type strings used by `GlobalUID.encode` | Changing a resource type string without updating this resolver |
