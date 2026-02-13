# GraphUtilityService.ts

## Purpose
Provides low-level graph operations for entities and relationships: read, search, traversal, and soft/hard deactivation.

## Components

### `getNodeById`, `getNodesByIds`, `queryNodes`, `searchNodesByText`, `searchNodesByPrefix`
- **Does**: Node lookup and search helpers with ownership and active-state filtering.
- **Interacts with**: `GraphNodeEntity` repository.

### `getRelationships`, `createOrUpdateRelationship`, `softDeleteRelationship`
- **Does**: Relationship querying and mutation helpers.
- **Interacts with**: `RelationshipEntity` repository.

### `traverseGraph`, `findConnectedEntities`
- **Does**: Bounded traversal from seed nodes with direction/type filters.
- **Interacts with**: Node and relationship retrieval helpers.

### `deactivateEntities`, `deactivateRelationships`
- **Does**: Bulk soft-delete or hard-delete operations.
- **Interacts with**: Repository bulk update/delete operations.

### `collectEntitySnapshot`
- **Does**: Returns a node plus optional outbound relationships for forget/deactivation workflows.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `ForgetKnowledgeTool` | Snapshot + deactivate helpers work with user scoping | Signature/ownership rule changes |
| Graph domain services | Upsert/query methods preserve `owner_user_id` semantics | Removing ownership filters |

## Notes
- Fact archival methods were removed after dropping the `ci.facts` table.
