import { PeerLinkService } from './PeerLinkService';

function makeService() {
  const repository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((row: unknown) => row),
    save: jest.fn().mockImplementation((row: unknown) => Promise.resolve({ ...(row as object) })),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const service = new PeerLinkService(repository as never, logger as never);

  return { service, repository };
}

const CTX = { userId: 'owner-1' };
const DTO = { peerHandle: 'devon', memoryEndpoint: 'https://devon.example.com/agent/v1' };

/**
 * `ci.peer_links.trust_tier` CHECKs four values. A fifth, `household`, exists in
 * the `TrustTier` union and is the LOCAL tier — the widest ceiling in
 * `TIER_CEILINGS` and the only one exempt from the sensitive-class floor. The
 * type already excludes it at COMPILE time, but this method's input arrives from
 * a Portal directory descriptor and from GraphQL, where a type is only a
 * promise: unguarded, the CHECK fires as a `23514` the driver raises AFTER the
 * statement, which surfaces to a caller as a bare `500 Internal server error`.
 */
describe('PeerLinkService.upsert — the trust tier is validated before the write', () => {
  it('refuses `household` by name, in front of the insert', async () => {
    const { service, repository } = makeService();

    await expect(service.upsert(CTX as never, { ...DTO, trustTier: 'household' as never })).rejects.toThrow(
      /Unknown peer trust tier: household/,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('refuses anything else the CHECK would reject', async () => {
    const { service, repository } = makeService();

    for (const bad of ['admin', 'FAMILY', '']) {
      await expect(service.upsert(CTX as never, { ...DTO, trustTier: bad as never })).rejects.toThrow(
        /Unknown peer trust tier/,
      );
    }

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('accepts every tier the CHECK admits', async () => {
    for (const tier of ['family', 'trusted', 'peer', 'stranger'] as const) {
      const { service, repository } = makeService();

      await service.upsert(CTX as never, { ...DTO, trustTier: tier });

      expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ trustTier: tier }));
    }
  });

  it('still defaults to `peer` when the caller says nothing', async () => {
    const { service, repository } = makeService();

    await service.upsert(CTX as never, DTO);

    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ trustTier: 'peer' }));
  });
});
