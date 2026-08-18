/**
 * Qwen/vLLM tool-calls for `memory.remember` rarely match the Zod schema
 * literally. Structured `tool_calls` still arrive with `op: upsert`, nested
 * `entity: {…}` blobs, `fromEntity`/`toEntityName` aliases, and comma-separated
 * JSON in `operations`. Coerce that into the shape WriteKnowledgeTool executes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_BY_MASHED: Record<string, string> = {
  entitycreate: 'entity.create',
  createentity: 'entity.create',
  upsert: 'entity.create',
  upsertentity: 'entity.create',
  addentity: 'entity.create',
  entityupdate: 'entity.update',
  updateentity: 'entity.update',
  relationshipcreate: 'relationship.create',
  createrelationship: 'relationship.create',
  addrelationship: 'relationship.create',
  link: 'relationship.create',
  relationshipupdate: 'relationship.update',
  updaterelationship: 'relationship.update',
};

export function coerceWriteKnowledgeInput(input: unknown): unknown {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const record = input as Record<string, unknown>;
  const operations = coerceOperationsField(record.operations ?? record.relationships);
  if (operations == null) {
    return input;
  }

  return { ...record, operations };
}

function coerceOperationsField(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) {
    return raw.map(coerceOperation);
  }

  if (raw != null && typeof raw === 'object') {
    return [coerceOperation(raw)];
  }

  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }

  const trimmed = raw.trim();
  const wrapped = trimmed.startsWith('[') ? trimmed : `[${trimmed}]`;

  try {
    const parsed: unknown = JSON.parse(wrapped);
    if (Array.isArray(parsed)) {
      return parsed.map(coerceOperation);
    }

    if (parsed != null && typeof parsed === 'object') {
      return [coerceOperation(parsed)];
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function coerceOperation(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const operation = { ...(raw as Record<string, unknown>) };

  if (operation.entity != null && typeof operation.entity === 'object' && !Array.isArray(operation.entity)) {
    const nested = operation.entity as Record<string, unknown>;
    operation.entityType ??= nested.entityType ?? nested.type;
    operation.name ??= nested.name;
    operation.description ??= nested.description;
    operation.properties ??= nested.properties;
    delete operation.entity;
  }

  const kindSource =
    typeof operation.kind === 'string'
      ? operation.kind
      : typeof operation.op === 'string'
        ? operation.op
        : typeof operation.action === 'string'
          ? operation.action
          : undefined;
  if (kindSource) {
    operation.kind = canonicalizeKind(kindSource);
    delete operation.op;
    delete operation.action;
  }

  if (typeof operation.relationshipName === 'string' && operation.relationshipType == null) {
    operation.relationshipType = operation.relationshipName;
    delete operation.relationshipName;
  }

  assignEndpoint(operation, 'fromEntityId', 'from', [
    'from',
    'fromEntity',
    'fromEntityId',
    'fromEntityName',
    'source',
    'sourceEntityId',
  ]);
  assignEndpoint(operation, 'toEntityId', 'to', [
    'to',
    'toEntity',
    'toEntityId',
    'toEntityName',
    'target',
    'targetEntityId',
  ]);

  for (const alias of [
    'fromEntity',
    'fromEntityName',
    'source',
    'sourceEntityId',
    'toEntity',
    'toEntityName',
    'target',
    'targetEntityId',
    'relationshipName',
  ]) {
    delete operation[alias];
  }

  if (typeof operation.kind !== 'string' || operation.kind === kindSource) {
    operation.kind = inferKind(operation);
  }

  return operation;
}

function inferKind(operation: Record<string, unknown>): string | undefined {
  if (typeof operation.kind === 'string' && operation.kind.includes('.')) {
    return operation.kind;
  }

  if (
    operation.relationshipType != null ||
    operation.from != null ||
    operation.to != null ||
    operation.fromEntityId != null ||
    operation.toEntityId != null
  ) {
    return 'relationship.create';
  }

  if (operation.entityType != null || operation.name != null) {
    return 'entity.create';
  }

  return typeof operation.kind === 'string' ? operation.kind : undefined;
}

function assignEndpoint(
  operation: Record<string, unknown>,
  idKey: 'fromEntityId' | 'toEntityId',
  refKey: 'from' | 'to',
  aliases: string[],
): void {
  for (const alias of aliases) {
    if (operation[alias] == null) {
      continue;
    }

    applyEndpointValue(operation, idKey, refKey, operation[alias]);
  }

  if (typeof operation[refKey] === 'string') {
    applyEndpointValue(operation, idKey, refKey, operation[refKey]);
  }
}

function applyEndpointValue(
  operation: Record<string, unknown>,
  idKey: 'fromEntityId' | 'toEntityId',
  refKey: 'from' | 'to',
  value: unknown,
): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (UUID_RE.test(trimmed)) {
      operation[idKey] ??= trimmed;
    } else if (trimmed !== '') {
      operation[refKey] ??= { name: trimmed };
    }

    return;
  }

  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.entityId === 'string' ? record.entityId : typeof record.id === 'string' ? record.id : undefined;
  if (id && UUID_RE.test(id)) {
    operation[idKey] ??= id;
  }

  if (typeof record.name === 'string' && record.name.trim() !== '') {
    operation[refKey] ??= {
      name: record.name,
      ...(typeof record.entityType === 'string' ? { entityType: record.entityType } : {}),
    };
  }
}

function canonicalizeKind(raw: string): string {
  const mashed = raw.replace(/[_.-]/g, '').toLowerCase();

  return KIND_BY_MASHED[mashed] ?? raw;
}
