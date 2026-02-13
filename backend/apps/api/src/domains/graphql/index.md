# index.ts

## Purpose
Configures the GraphQL module, registering resolver providers, data loaders, and domain module dependencies.

## Components

### `GraphQLModule`
- **Does**: Wires Apollo/Nest GraphQL runtime and resolver/provider list.
- **Interacts with**: Domain modules (`MemoryModule`, `SearchNextModule`, etc.) and resolver classes.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| API clients | Registered resolvers expose expected schema fields | Removing resolver/provider entries |
| Domain modules | Required modules are imported | Missing module import breaks resolver injection |

## Notes
- Fact resolver registration was removed after facts-domain retirement.
