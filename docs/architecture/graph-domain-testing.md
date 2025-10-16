# Graph Domain Testing Guide

This document explains how to exercise the new event-driven graph domain from both the API and internal services. It covers:

- How setters ("writes") behave and how to fire them through HTTP (cURL examples)
- How getters ("reads") return data synchronously
- How backend services should use the `GraphEventService` and `GraphQueryService`
- How the frontend can call the same endpoints with `fetch`

> **Important:** All write operations are asynchronous. Controllers enqueue events via PgBoss and immediately return optimistic responses. Verify writes by calling the read APIs after the worker finishes processing.

## Prerequisites

- `make dev` or a running backend (`backend/apps/api`) with database and PgBoss available
- A valid JWT access token for the authenticated user (substitute `${TOKEN}` below)
- The user ID that maps to the JWT (substitute `${USER_ID}`) when testing direct service calls

All examples assume the API is reachable at `http://localhost:3000`.

---

## Testing Setters (writes)

### Add a Person

```bash
curl -X POST http://localhost:3000/graph/person \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "name": "Jane Doe",
    "firstName": "Jane",
    "lastName": "Doe",
    "bio": "Product designer and coffee enthusiast",
    "relationships": [
      {
        "toPersonEntityId": "<existing-entity-id>",
        "type": "FRIEND",
        "strength": 0.8
      }
    ],
    "properties": {
      "favoriteCoffee": "flat white"
    }
  }'
```

### Add Multiple Preferences

```bash
curl -X POST http://localhost:3000/graph/preferences \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "personEntityId": "<person-entity-id>",
    "preferences": [
      { "name": "Cycling", "type": "activity", "strength": 0.9 },
      { "name": "Horror Movies", "type": "genre", "isDislike": true }
    ]
  }'
```

### Record a Visit

```bash
curl -X POST http://localhost:3000/graph/visit \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "personEntityId": "<person-entity-id>",
    "locationEntityId": "<location-entity-id>",
    "date": "2024-07-01",
    "notes": "First time at the new café"
  }'
```

### Update a Node

```bash
curl -X POST http://localhost:3000/graph/node/update \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "entityId": "<entity-id>",
    "name": "Jane “JD” Doe",
    "properties": {
      "nickname": "JD"
    }
  }'
```

### Delete a Relationship

```bash
curl -X POST http://localhost:3000/graph/relationship/delete \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "relationshipId": "<relationship-id>"
  }'
```

---

## Testing Getters (reads)

Reads are synchronous and hit the new `GraphQueryService` through the controller.

### Fetch Graph Data (nodes + relationships)

```bash
curl -X GET http://localhost:3000/graph/data \
  -H "Authorization: Bearer ${TOKEN}"
```

### Retrieve User Context Snapshot

```bash
curl -X GET http://localhost:3000/graph/context \
  -H "Authorization: Bearer ${TOKEN}"
```

### Retrieve Formatted Context (System Prompt)

```bash
curl -X GET http://localhost:3000/graph/context/formatted \
  -H "Authorization: Bearer ${TOKEN}"
```

If a write was enqueued moments earlier, you may need to wait for the PgBoss worker (or inspect the background logs) before these reads reflect changes.

---

## Backend Usage

### Publishing mutations

Services should depend on `GraphEventService` (exported from `@ci/domains/memory`). Example within a Nest service:

```ts
@Injectable()
export class ProfileService {
  constructor(private readonly graphEvents: GraphEventService) {}

  async connectPeople(ownerId: string, fromId: string, toId: string) {
    await this.graphEvents.addConnection(ownerId, {
      fromPersonId: fromId,
      toPersonId: toId,
      connectionType: 'FRIEND',
      context: 'met at conference',
    });
  }
}
```

### Querying graph data

For reads, inject the `GraphQueryService` from `@ci/domains/graph`:

```ts
@Injectable()
export class InsightsService {
  constructor(private readonly graphQuery: GraphQueryService) {}

  async findFavorites(ownerId: string, personId: string) {
    const relationships = await this.graphQuery.getRelationships(ownerId, {
      entityIds: [personId],
      relationshipTypes: ['PREFERS'],
    });

    return relationships.map(({ to_entity_id, properties }) => ({
      conceptId: to_entity_id,
      context: properties?.context ?? 'user preference',
    }));
  }
}
```

`GraphQueryService` also exposes `getNodes`, `getNode`, `findConceptByName`, `findConnectedEntities`, and `traverseGraph` for richer queries.

---

## Frontend Usage

Any HTTP client can call the `/graph/*` routes. In the React/Vite app, you can use `fetch` with the session token:

```ts
async function addFamilyMember(token: string, payload: unknown) {
  const res = await fetch('/graph/family', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Failed to add family members: ${res.status}`);
  }

  return res.json();
}
```

For reads, the same pattern applies:

```ts
async function loadGraphData(token: string) {
  const res = await fetch('/graph/data', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('Unable to load graph data');
  }

  return res.json();
}
```

---

## Observability Tips

- Tail the worker logs (`make dev` runs PgBoss consumers inside the API process). Successful event handling will log under `GraphEventListener`.
- To inspect basic stats, use `GraphQueryService.getRelationships` and `getNodes` directly from a debugger or implement a temporary admin endpoint.
- Remember that writes depend on background processing: if you stop the worker, events remain in PgBoss until it resumes.

---

## Summary

1. **Writes**: Publish through the `/graph/*` HTTP endpoints or `GraphEventService`.
2. **Reads**: Use `/graph/context`, `/graph/data`, or call `GraphQueryService` internally.
3. **Frontend**: Reuse the same REST endpoints with the user’s JWT.
4. **Verification**: Confirm data by calling the read endpoints once the queue has processed the event.

This workflow keeps the graph decoupled, enforces consistent write behavior, and provides a reliable way to spot-check changes.
