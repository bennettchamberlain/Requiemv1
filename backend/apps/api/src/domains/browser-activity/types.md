# types.ts

## Purpose
Defines request schemas and DTOs for browser activity ingestion/update operations. It centralizes API-level validation so controllers/services receive normalized data.

## Components

### `createBrowserActivitySchemaRoot`
- **Does**: Validates a single browser activity payload.
- **Interacts with**: `BrowserActivityController` request parsing.

### `createBrowserActivitySchema`
- **Does**: Accepts either one payload or an array payload.
- **Interacts with**: Bulk create endpoint behavior.

### `updateBrowserActivitySchema`
- **Does**: Validates partial updates.
- **Interacts with**: Update endpoint semantics.

### `CreateBrowserActivityDto` / `UpdateBrowserActivityDto`
- **Does**: Typed contracts passed into service layer.
- **Interacts with**: `BrowserActivityService` create/update methods.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Browser activity controller | DTO fields match persisted model | Renaming/removing DTO keys |
| Browser activity service | Validated optional fields | Changing validation optionality |

## Notes
Embedding fields were removed to align with migration strategy that keeps embeddings in `ci_search` instead of `ci.browser_activity`.
