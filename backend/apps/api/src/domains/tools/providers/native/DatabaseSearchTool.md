# DatabaseSearchTool.ts

## Purpose
Executes semantic search against indexed entities and resolves IDs to domain objects for tool output.

## Components

### Input schema (`DatabaseSearchInputSchema`)
- **Does**: Validates query/search mode/scope/result limits.

### `executeInternal`
- **Does**: Calls `SearchService.search`, then resolves identifiers to typed entities.

### `resolveEntities`
- **Does**: Batches lookups by entity type and reorders results by search ranking order.
- **Interacts with**: Answer/communication/concept/content/event/file/item/person/place/thread services.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Tool runtime | Returns ordered `SearchResult[]` | Changing result ordering or entity mapping keys |
| Search consumers | Scope/type enums stay compatible | Removing supported scope values |

## Notes
- `facts` scope language was removed as part of facts-table retirement.
