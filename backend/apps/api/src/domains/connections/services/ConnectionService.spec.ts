import { NotFoundException } from '@nestjs/common';

import { SYSTEM_USER, type ServiceContext, type UserServiceContext } from '@ci/common/context';

import type { ConnectionEntity } from '../entities/ConnectionEntity';

import { ConnectionService } from './ConnectionService';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const OWN_CONTEXT = { userId: OWNER } as UserServiceContext;
const OTHER_CONTEXT = { userId: OTHER } as UserServiceContext;
const SYSTEM_CONTEXT = { userId: SYSTEM_USER } as ServiceContext;

const DEFAULT_PROVIDER = {
  id: 'provider-1',
  name: 'Google',
  description: null,
  endpoints: [],
  logoUrl: null,
  authType: 'oauth2',
  openidKeyLink: null,
  appSetupUrl: null,
  theme: {},
  localOnly: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function makeRow(overrides: Partial<ConnectionEntity> = {}): ConnectionEntity {
  return {
    id: 'conn-1',
    name: 'Google',
    active: true,
    schedule: null,
    accessToken: 'token',
    refreshToken: null,
    tokenExpiry: null,
    syncState: null,
    userId: OWNER,
    providerId: 'provider-1',
    activeEndpoints: ['gmail'],
    needsReauth: false,
    externalId: null,
    accountLabel: null,
    provider: DEFAULT_PROVIDER,
    ...overrides,
  } as ConnectionEntity;
}

function makeService(rows: ConnectionEntity[] = []) {
  const store = [...rows];

  const matches = (row: ConnectionEntity, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'id' && value && typeof value === 'object' && '_type' in (value as object)) {
        const ids = (value as { value: string[] }).value;

        return ids.includes(row.id);
      }

      if (key === 'user' && value && typeof value === 'object') {
        return row.userId === (value as { id: string }).id;
      }

      return (row as unknown as Record<string, unknown>)[key] === value;
    });

  const find = jest.fn(async ({ where }: { where: Record<string, unknown> | Record<string, unknown>[] }) => {
    const clauses = Array.isArray(where) ? where : [where];

    return store.filter((row) => clauses.some((clause) => matches(row, clause)));
  });

  const findOne = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return store.find((row) => matches(row, where)) ?? null;
  });

  const update = jest.fn(async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
    const matching = store.filter((row) => matches(row, where));

    for (const row of matching) {
      Object.assign(row, patch);
    }

    return { affected: matching.length };
  });

  const create = jest.fn((partial: Record<string, unknown>) => partial);
  const save = jest.fn(async (entity: Record<string, unknown>) => {
    const row = makeRow({
      ...entity,
      userId: (entity.user as { id: string })?.id ?? OWNER,
      providerId: (entity.provider as { id: string })?.id ?? 'provider-1',
    } as Partial<ConnectionEntity>);
    store.push(row);

    return row;
  });

  const repository = { find, findOne, update, create, save };
  const service = new ConnectionService(repository as never);

  return { service, store };
}

describe('ConnectionService — tenancy scoping', () => {
  it('findById returns the connection to its owner', async () => {
    const { service } = makeService([makeRow({ id: 'c1', userId: OWNER })]);

    const result = await service.findById(OWN_CONTEXT, 'c1');
    expect(result?.id).toBe('c1');
  });

  it('findById rejects a different user requesting the same connection', async () => {
    const { service } = makeService([makeRow({ id: 'c1', userId: OWNER })]);

    const result = await service.findById(OTHER_CONTEXT, 'c1');
    expect(result).toBeNull();
  });

  it('findById lets SYSTEM_USER read across owners', async () => {
    const { service } = makeService([makeRow({ id: 'c1', userId: OWNER })]);

    const result = await service.findById(SYSTEM_CONTEXT, 'c1');
    expect(result?.id).toBe('c1');
  });

  it('update refuses to touch another owner\'s connection', async () => {
    const { service, store } = makeService([makeRow({ id: 'c1', userId: OWNER, name: 'original' })]);

    const result = await service.update(OTHER_CONTEXT, 'c1', { name: 'hijacked' } as never);

    expect(result).toBeNull();
    expect(store[0].name).toBe('original');
  });

  it('remove refuses to deactivate another owner\'s connection', async () => {
    const { service, store } = makeService([makeRow({ id: 'c1', userId: OWNER, active: true })]);

    await expect(service.remove(OTHER_CONTEXT, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    expect(store[0].active).toBe(true);
  });

  it('remove deactivates (not deletes) the owner\'s own connection', async () => {
    const { service, store } = makeService([makeRow({ id: 'c1', userId: OWNER, active: true })]);

    const result = await service.remove(OWN_CONTEXT, 'c1');

    expect(result).toBe(true);
    expect(store[0].active).toBe(false);
  });
});

describe('ConnectionService.update — needsReauth computation', () => {
  it('is forced to false for openid connections regardless of scope changes', async () => {
    const { service } = makeService([
      makeRow({
        id: 'c1',
        userId: OWNER,
        needsReauth: true,
        activeEndpoints: ['a'],
        provider: { ...DEFAULT_PROVIDER, authType: 'openid' } as never,
      }),
    ]);

    const result = await service.update(OWN_CONTEXT, 'c1', { endpoints: ['a', 'brand-new-scope'] });

    expect(result?.needsReauth).toBe(false);
  });

  it('flips to true when the update introduces a scope the connection did not already have', async () => {
    const { service } = makeService([
      makeRow({ id: 'c1', userId: OWNER, needsReauth: false, activeEndpoints: ['gmail'] }),
    ]);

    const result = await service.update(OWN_CONTEXT, 'c1', { endpoints: ['gmail', 'calendar'] });

    expect(result?.needsReauth).toBe(true);
  });

  it('preserves an existing needsReauth:true when the endpoint update adds no new scopes', async () => {
    // A prior update already flagged reauth; re-sending the SAME endpoint set
    // must not silently clear that flag — the user still hasn't reauthed.
    const { service } = makeService([
      makeRow({ id: 'c1', userId: OWNER, needsReauth: true, activeEndpoints: ['gmail'] }),
    ]);

    const result = await service.update(OWN_CONTEXT, 'c1', { endpoints: ['gmail'] });

    expect(result?.needsReauth).toBe(true);
  });

  it('uses the caller-supplied needsReauth verbatim when endpoints are not part of the update', async () => {
    const { service } = makeService([
      makeRow({ id: 'c1', userId: OWNER, needsReauth: true, activeEndpoints: ['gmail'] }),
    ]);

    const result = await service.update(OWN_CONTEXT, 'c1', { needsReauth: false });

    expect(result?.needsReauth).toBe(false);
  });
});
