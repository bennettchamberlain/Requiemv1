import { ForbiddenException } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';

import { ApiKeyService } from '../services/ApiKeyService';

/**
 * Unit tests for the idempotency + scope surface added for the connect flow:
 *  - createOrRotate deletes any prior (user, name) key before minting a fresh one
 *  - removeByName is the system-level, cross-user revoke used by the Hub
 *  - findByName is owner-scoped
 *  - validateKey now returns the key's scopes (defaulting empty → full-access)
 * Repository is an in-memory jest mock — same pattern as SavedSearchService.test.ts.
 */
function makeRepo() {
  return {
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn(async (row: Record<string, unknown>) => row),
    findOne: jest.fn(),
    delete: jest.fn(async () => ({ affected: 1 })),
    update: jest.fn(async () => ({ affected: 1 })),
    find: jest.fn(),
  };
}

const ownerCtx = { userId: 'owner-1' } as UserServiceContext;

describe('ApiKeyService.createOrRotate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes any existing (user, name) key, then mints and returns a fresh raw key', async () => {
    const repo = makeRepo();
    const service = new ApiKeyService(repo as never);

    const result = await service.createOrRotate(ownerCtx, { name: 'app:urn:x', scopes: ['memory'] });

    // Rotation: prior key for this (user, name) is removed before minting.
    expect(repo.delete).toHaveBeenCalledWith({ user_id: 'owner-1', name: 'app:urn:x' });
    expect(repo.delete.mock.invocationCallOrder[0]).toBeLessThan(repo.save.mock.invocationCallOrder[0]);

    // Minted row is owner-scoped, carries the requested scopes, and the raw key
    // is 64 hex chars returned exactly once.
    const row = repo.create.mock.calls[0][0];
    expect(row.user_id).toBe('owner-1');
    expect(row.name).toBe('app:urn:x');
    expect(row.scopes).toEqual(['memory']);
    expect(result.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mints a non-expiring key when no expires_at is given', async () => {
    const repo = makeRepo();
    const service = new ApiKeyService(repo as never);

    await service.createOrRotate(ownerCtx, { name: 'app:urn:y', scopes: ['memory'] });

    expect(repo.create.mock.calls[0][0].expires_at).toBeNull();
  });

  it('retries once and succeeds when a concurrent mint trips the unique index (23505)', async () => {
    const repo = makeRepo();
    // First insert loses the race on the (user, name) unique index; the retry wins.
    repo.save
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }))
      .mockImplementationOnce(async (row: Record<string, unknown>) => row);
    const service = new ApiKeyService(repo as never);

    const result = await service.createOrRotate(ownerCtx, { name: 'app:urn:z', scopes: ['memory'] });

    // Deleted again before the retry insert; a usable key is returned (no 500).
    expect(repo.delete).toHaveBeenCalledTimes(2);
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(result.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rethrows a non-unique-violation error without retrying', async () => {
    const repo = makeRepo();
    repo.save.mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: '08006' }));
    const service = new ApiKeyService(repo as never);

    await expect(service.createOrRotate(ownerCtx, { name: 'app:urn:w', scopes: ['memory'] })).rejects.toThrow(
      'connection reset',
    );
    expect(repo.delete).toHaveBeenCalledTimes(1);
  });
});

describe('ApiKeyService.removeByName', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes by name across all owners and returns the count', async () => {
    const repo = makeRepo();
    repo.delete.mockResolvedValueOnce({ affected: 2 });
    const service = new ApiKeyService(repo as never);

    const removed = await service.removeByName('app:urn:x');

    expect(repo.delete).toHaveBeenCalledWith({ name: 'app:urn:x' });
    expect(removed).toBe(2);
  });

  it('returns 0 when nothing matched', async () => {
    const repo = makeRepo();
    repo.delete.mockResolvedValueOnce({ affected: 0 });
    const service = new ApiKeyService(repo as never);

    expect(await service.removeByName('app:urn:none')).toBe(0);
  });
});

describe('ApiKeyService.findByName', () => {
  beforeEach(() => jest.clearAllMocks());

  it('looks up owner-scoped by name', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({
      id: 'k1',
      name: 'app:urn:x',
      prefix: 'abcde',
      scopes: ['memory'],
      expires_at: null,
      last_used_at: null,
      user_id: 'owner-1',
      created_at: new Date(),
      updated_at: new Date(),
    });
    const service = new ApiKeyService(repo as never);

    const key = await service.findByName(ownerCtx, 'app:urn:x');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { user_id: 'owner-1', name: 'app:urn:x' } });
    expect(key?.name).toBe('app:urn:x');
  });

  it('returns null when no key exists', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce(null);
    const service = new ApiKeyService(repo as never);

    expect(await service.findByName(ownerCtx, 'missing')).toBeNull();
  });
});

describe('ApiKeyService.update', () => {
  beforeEach(() => jest.clearAllMocks());

  const managedKey = {
    id: 'k-managed',
    name: 'app:ci-openclaw:ci-marketplace',
    prefix: 'abcde',
    scopes: ['memory'],
    expires_at: null,
    last_used_at: null,
    user_id: 'owner-1',
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('refuses to rename a Hub-managed connection key (would orphan the Hub revoke)', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({ ...managedKey });
    const service = new ApiKeyService(repo as never);

    await expect(service.update(ownerCtx, 'k-managed', { name: 'stolen' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses to re-scope a Hub-managed connection key', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({ ...managedKey });
    const service = new ApiKeyService(repo as never);

    await expect(service.update(ownerCtx, 'k-managed', { scopes: [] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('tolerates a no-op submit that echoes the managed key name and scopes', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({ ...managedKey });
    const service = new ApiKeyService(repo as never);

    const result = await service.update(ownerCtx, 'k-managed', {
      name: 'app:ci-openclaw:ci-marketplace',
      scopes: ['memory'],
    });

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result?.name).toBe('app:ci-openclaw:ci-marketplace');
  });

  it('renames an ordinary (non-managed) key', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({ ...managedKey, id: 'k-user', name: 'My key', scopes: [] });
    const service = new ApiKeyService(repo as never);

    const result = await service.update(ownerCtx, 'k-user', { name: 'Renamed' });

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result?.name).toBe('Renamed');
  });

  it('treats an app:-named key WITHOUT the memory scope as ordinary (renamable)', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({ ...managedKey, id: 'k-appish', scopes: [] });
    const service = new ApiKeyService(repo as never);

    const result = await service.update(ownerCtx, 'k-appish', { name: 'renamed' });

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result?.name).toBe('renamed');
  });

  it('returns null when the key does not exist', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce(null);
    const service = new ApiKeyService(repo as never);

    expect(await service.update(ownerCtx, 'missing', { name: 'x' })).toBeNull();
  });
});

describe('ApiKeyService.validateKey', () => {
  const validRaw = 'a'.repeat(64);

  beforeEach(() => jest.clearAllMocks());

  it('returns userId and scopes for a live key', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({
      id: 'k1',
      user_id: 'owner-1',
      expires_at: null,
      scopes: ['memory'],
    });
    const service = new ApiKeyService(repo as never);

    expect(await service.validateKey(validRaw)).toEqual({ userId: 'owner-1', scopes: ['memory'] });
  });

  it('defaults a null scopes column to empty (legacy full-access)', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({ id: 'k1', user_id: 'owner-1', expires_at: null, scopes: null });
    const service = new ApiKeyService(repo as never);

    expect(await service.validateKey(validRaw)).toEqual({ userId: 'owner-1', scopes: [] });
  });

  it('rejects an expired key', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({
      id: 'k1',
      user_id: 'owner-1',
      expires_at: new Date(Date.now() - 1000),
      scopes: ['memory'],
    });
    const service = new ApiKeyService(repo as never);

    expect(await service.validateKey(validRaw)).toBeNull();
  });

  it('rejects a malformed key without hitting the database', async () => {
    const repo = makeRepo();
    const service = new ApiKeyService(repo as never);

    expect(await service.validateKey('not-hex')).toBeNull();
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});
