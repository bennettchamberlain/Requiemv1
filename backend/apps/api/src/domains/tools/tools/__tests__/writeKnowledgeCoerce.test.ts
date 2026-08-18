import { coerceWriteKnowledgeInput } from '../writeKnowledgeCoerce';

describe('coerceWriteKnowledgeInput', () => {
  it('maps Qwen op:create_entity payloads onto kind:entity.create', () => {
    const coerced = coerceWriteKnowledgeInput({
      operations: [
        {
          op: 'create_entity',
          entityType: 'place',
          name: 'Example Home',
          properties: { type: 'home' },
        },
        {
          op: 'create_relationship',
          from: { entityType: 'person', name: 'alex' },
          relationshipType: 'LIVES_AT',
          to: { entityType: 'place', name: 'Example Home' },
        },
      ],
    });

    expect(coerced).toEqual({
      operations: [
        {
          kind: 'entity.create',
          entityType: 'place',
          name: 'Example Home',
          properties: { type: 'home' },
        },
        {
          kind: 'relationship.create',
          from: { entityType: 'person', name: 'alex' },
          relationshipType: 'LIVES_AT',
          to: { entityType: 'place', name: 'Example Home' },
        },
      ],
    });
  });

  it('unwraps nested entity blobs and comma-separated operations JSON', () => {
    const coerced = coerceWriteKnowledgeInput({
      operations:
        '{"kind": "entity.create", "entity": {"entityType": "place", "name": "Airport", "properties": {"type": "airport"}}}, {"kind": "entity.create", "entity": {"entityType": "place", "name": "Home"}}',
    });

    expect(coerced).toEqual({
      operations: [
        {
          kind: 'entity.create',
          entityType: 'place',
          name: 'Airport',
          properties: { type: 'airport' },
        },
        {
          kind: 'entity.create',
          entityType: 'place',
          name: 'Home',
        },
      ],
    });
  });

  it('maps op:upsert, fromEntity UUIDs, and toEntityName onto the native schema', () => {
    const personId = '019fc4ea-ca9a-7576-b795-f4037078abe8';
    const coerced = coerceWriteKnowledgeInput({
      operations: [
        {
          op: 'upsert',
          entity: { entityType: 'place', name: 'Example Airport' },
          properties: { type: 'airport' },
        },
        {
          fromEntity: personId,
          toEntityName: 'Example Home',
          relationshipType: 'LIVES_AT',
        },
      ],
    });

    expect(coerced).toEqual({
      operations: [
        {
          kind: 'entity.create',
          entityType: 'place',
          name: 'Example Airport',
          properties: { type: 'airport' },
        },
        {
          kind: 'relationship.create',
          fromEntityId: personId,
          to: { name: 'Example Home' },
          relationshipType: 'LIVES_AT',
        },
      ],
    });
  });

  it('maps a relationships[] payload onto relationship.create operations', () => {
    const fromId = '01a012fd-1391-7167-8fa5-3ff4d4c12473';
    const toId = '01a012fd-1393-77c5-8f18-478dbeb86d98';
    const coerced = coerceWriteKnowledgeInput({
      relationships: [
        {
          entityType: 'relationship',
          sourceEntityId: fromId,
          targetEntityId: toId,
          relationshipName: 'LIVES_AT',
        },
      ],
    });

    expect(coerced).toEqual({
      relationships: [
        {
          entityType: 'relationship',
          sourceEntityId: fromId,
          targetEntityId: toId,
          relationshipName: 'LIVES_AT',
        },
      ],
      operations: [
        {
          kind: 'relationship.create',
          entityType: 'relationship',
          fromEntityId: fromId,
          toEntityId: toId,
          relationshipType: 'LIVES_AT',
        },
      ],
    });
  });
});
