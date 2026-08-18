import { SYSTEM_USER, type ServiceContext, type UserServiceContext } from '@ci/common/context';

import type { ProviderKeyEntity } from '../entities/ProviderKeyEntity';

import { ProviderKeyService } from './ProviderKeyService';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const OWN_CONTEXT = { userId: OWNER } as UserServiceContext;
const OTHER_CONTEXT = { userId: OTHER } as UserServiceContext;
const SYSTEM_CONTEXT = { userId: SYSTEM_USER } as ServiceContext;

function makeRow(overrides: Partial<ProviderKeyEntity> = {}): ProviderKeyEntity {
  return {
    id: 'key-1',
    providerId: 'provider-1',
    clientId: 'client-id',
    clientSecret: 'super-secret',
    userId: OWNER,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as ProviderKeyEntity;
}

function makeService(rows: ProviderKeyEntity[] = []) {
  const store = [...rows];

  const matches = (row: ProviderKeyEntity, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'id' && value && typeof value === 'object' && '_type' in (value as object)) {
        return (value as { value: string[] }).value.includes(row.id);
      }

      return (row as unknown as Record<string, unknown>)[key] === value;
    });

  const find = jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    store.filter((row) => matches(row, where)),
  );

  const findOne = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return store.find((row) => matches(row, where)) ?? null;
  });

  const update = jest.fn(async (id: string, patch: Record<string, unknown>) => {
    const row = store.find((r) => r.id === id);
    if (row) {Object.assign(row, patch);}

    return { affected: row ? 1 : 0 };
  });

  const del = jest.fn(async (id: string) => {
    const index = store.findIndex((r) => r.id === id);
    if (index !== -1) {store.splice(index, 1);}

    return { affected: index !== -1 ? 1 : 0 };
  });

  const create = jest.fn((partial: Record<string, unknown>) => partial);
  const save = jest.fn(async (entity: Record<string, unknown>) => {
    const row = makeRow(entity as Partial<ProviderKeyEntity>);
    store.push(row);

    return row;
  });

  const repository = { find, findOne, update, delete: del, create, save };
  const service = new ProviderKeyService(repository as never);

  return { service, store };
}

describe('ProviderKeyService — tenancy scoping', () => {
  it('findAll returns only the caller\'s own keys for a non-system caller', async () => {
    const { service } = makeService([
      makeRow({ id: 'mine', userId: OWNER }),
      makeRow({ id: 'theirs', userId: OTHER }),
    ]);

    const results = await service.findAll(OWN_CONTEXT);

    expect(results.map((r) => r.id)).toEqual(['mine']);
  });

  it('findAll does not scope by owner for SYSTEM_USER', async () => {
    const { service } = makeService([
      makeRow({ id: 'mine', userId: OWNER }),
      makeRow({ id: 'theirs', userId: OTHER }),
    ]);

    const results = await service.findAll(SYSTEM_CONTEXT);

    expect(results.map((r) => r.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('findById rejects a different user requesting the same key id', async () => {
    const { service } = makeService([makeRow({ id: 'k1', userId: OWNER })]);

    const result = await service.findById(OTHER_CONTEXT, 'k1');
    expect(result).toBeNull();
  });

  it('findByIds null-fills ids owned by someone else', async () => {
    const { service } = makeService([
      makeRow({ id: 'mine', userId: OWNER }),
      makeRow({ id: 'theirs', userId: OTHER }),
    ]);

    const results = await service.findByIds(OWN_CONTEXT, ['theirs', 'mine']);

    expect(results[0]).toBeNull();
    expect(results[1]?.id).toBe('mine');
  });

  it('findByProviderId is always scoped to the calling user, never SYSTEM-wide', async () => {
    const { service } = makeService([
      makeRow({ id: 'mine', userId: OWNER, providerId: 'p1' }),
      makeRow({ id: 'theirs', userId: OTHER, providerId: 'p1' }),
    ]);

    const result = await service.findByProviderId(OWN_CONTEXT, 'p1');
    expect(result?.id).toBe('mine');
  });

  it('update refuses to modify a key owned by a different user', async () => {
    const { service, store } = makeService([makeRow({ id: 'k1', userId: OWNER, clientId: 'original' })]);

    const result = await service.update(OTHER_CONTEXT, 'k1', { clientId: 'hijacked' });

    expect(result).toBeNull();
    expect(store[0].clientId).toBe('original');
  });

  it('delete refuses to remove a key owned by a different user', async () => {
    const { service, store } = makeService([makeRow({ id: 'k1', userId: OWNER })]);

    const result = await service.delete(OTHER_CONTEXT, 'k1');

    expect(result).toBe(false);
    expect(store).toHaveLength(1);
  });

  it('delete removes the owner\'s own key', async () => {
    const { service, store } = makeService([makeRow({ id: 'k1', userId: OWNER })]);

    const result = await service.delete(OWN_CONTEXT, 'k1');

    expect(result).toBe(true);
    expect(store).toHaveLength(0);
  });
});
