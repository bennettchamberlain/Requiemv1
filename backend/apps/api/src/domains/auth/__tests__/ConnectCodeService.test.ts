import { createHash } from 'crypto';

import { isEncrypted } from '@ci/common/crypto';

import { ConnectCodeService } from '../services/ConnectCodeService';

/**
 * Unit tests for ConnectCodeService — the single-use bridge between the
 * browser consent step and the Hub's server-to-server key exchange.
 * Repository is an in-memory jest mock; encryption uses the real field-crypto
 * (config test fieldKey), so issue→consume is a genuine encrypt/decrypt round-trip.
 */
function makeRepo() {
  return {
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn(async (row: Record<string, unknown>) => row),
    findOne: jest.fn(),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(async () => ({ affected: 0 })),
  };
}

function makeLogger() {
  return { setContext: jest.fn(), debug: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('ConnectCodeService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('issues a hashed, encrypted, TTL-bounded code and returns the raw code once', async () => {
    const repo = makeRepo();
    const service = new ConnectCodeService(repo as never, makeLogger() as never);

    const code = await service.issue('user-1', 'urn:app:x', 'raw-api-key');

    expect(code).toMatch(/^[0-9a-f]{64}$/);
    const row = repo.create.mock.calls[0][0] as {
      hashed_code: string;
      encrypted_key: string;
      user_id: string;
      app_urn: string;
      used_at: Date | null;
      expires_at: Date;
    };
    expect(row.hashed_code).toBe(sha256(code)); // raw code never stored
    expect(isEncrypted(row.encrypted_key)).toBe(true); // key stored encrypted
    expect(row.user_id).toBe('user-1');
    expect(row.app_urn).toBe('urn:app:x');
    expect(row.used_at).toBeNull();
    expect(row.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('round-trips: consume decrypts the key and binds it to (user, app)', async () => {
    const repo = makeRepo();
    const service = new ConnectCodeService(repo as never, makeLogger() as never);

    const code = await service.issue('user-1', 'urn:app:x', 'raw-api-key');
    const saved = repo.save.mock.calls[0][0];
    repo.findOne.mockResolvedValueOnce(saved);

    const consumed = await service.consume(code);

    expect(repo.findOne).toHaveBeenCalledWith({ where: { hashed_code: sha256(code) } });
    expect(consumed).toEqual({ userId: 'user-1', appUrn: 'urn:app:x', key: 'raw-api-key' });
  });

  it('wipes the encrypted key on consume so a used row retains no recoverable key material', async () => {
    const repo = makeRepo();
    const service = new ConnectCodeService(repo as never, makeLogger() as never);

    const code = await service.issue('user-1', 'urn:app:x', 'raw-api-key');
    repo.findOne.mockResolvedValueOnce(repo.save.mock.calls[0][0]);

    await service.consume(code);

    const [, values] = repo.update.mock.calls[0] as [unknown, { used_at: Date; encrypted_key: string }];
    expect(values.encrypted_key).toBe(''); // ciphertext cleared as part of the atomic claim
    expect(values.used_at).toBeInstanceOf(Date);
  });

  it('opportunistically sweeps expired rows on issue (no dedicated scheduler)', async () => {
    const repo = makeRepo();
    const service = new ConnectCodeService(repo as never, makeLogger() as never);

    await service.issue('user-1', 'urn:app:x', 'raw-api-key');

    expect(repo.delete).toHaveBeenCalled(); // pruneExpired fired
  });

  it('rejects an unknown code', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce(null);
    const service = new ConnectCodeService(repo as never, makeLogger() as never);

    expect(await service.consume('deadbeef')).toBeNull();
  });

  it('rejects an already-used code', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({
      id: 'c1',
      app_urn: 'urn:app:x',
      user_id: 'user-1',
      used_at: new Date(),
      expires_at: new Date(Date.now() + 10_000),
      encrypted_key: 'enc:v1:x',
    });
    const service = new ConnectCodeService(repo as never, makeLogger() as never);

    expect(await service.consume('somecode')).toBeNull();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects an expired code', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValueOnce({
      id: 'c1',
      app_urn: 'urn:app:x',
      user_id: 'user-1',
      used_at: null,
      expires_at: new Date(Date.now() - 1),
      encrypted_key: 'enc:v1:x',
    });
    const service = new ConnectCodeService(repo as never, makeLogger() as never);

    expect(await service.consume('somecode')).toBeNull();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('loses the race when the atomic claim affects no rows (concurrent exchange)', async () => {
    const repo = makeRepo();
    const service = new ConnectCodeService(repo as never, makeLogger() as never);

    const code = await service.issue('user-1', 'urn:app:x', 'raw-api-key');
    const saved = repo.save.mock.calls[0][0];
    repo.findOne.mockResolvedValueOnce(saved);
    repo.update.mockResolvedValueOnce({ affected: 0 }); // another exchange claimed it first

    expect(await service.consume(code)).toBeNull();
  });
});
