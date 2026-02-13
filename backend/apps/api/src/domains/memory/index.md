# index.ts

## Purpose
Registers and exports the memory domain module. This file defines which memory entities/services are wired into Nest and what is exposed to other modules.

## Components

### `MemoryModule`
- **Does**: Declares TypeORM entities, providers, controllers, and exports for memory features.
- **Interacts with**: `@nestjs/typeorm`, `UserModule`, `EventsModule`, `FilesModule`, `BrowserActivityModule`.
- **Rationale**: Centralizes graph/memory wiring so downstream modules import one module.

### Export block
- **Does**: Re-exports memory entities, services, and selected types.
- **Interacts with**: GraphQL, tools, and other domains that depend on memory APIs.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| GraphQL module | Exported services/entities remain available | Removing exported service/entity |
| Tool providers | `GraphUtilityService` and domain services are injectable | Provider removed from exports |

## Notes
- Fact-related wiring was removed alongside `ci.facts` table retirement.
