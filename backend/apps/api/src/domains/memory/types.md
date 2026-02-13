# types.ts

## Purpose
Defines DTOs and Zod validation schemas for memory domain APIs (graph, communications, events, etc.). It is the shared contract layer between transport and service logic.

## Components

### Communication DTOs and schemas
- **Does**: Validates and types create/update payloads for communications.
- **Interacts with**: `CommunicationService`, memory controllers.

### Graph/Event DTOs and schemas
- **Does**: Defines typed payload contracts for concept/event flows.
- **Interacts with**: Graph and event service handlers.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Memory controllers | Zod schemas accept expected request fields | Removing/renaming schema keys |
| Memory services | DTO types match persistence model | Type incompatibility in service assignments |

## Notes
`content_embedding` was removed from communication DTO/schema definitions to match database schema cleanup.
