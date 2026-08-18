import { HealSelfCollationService } from './HealSelfCollationService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const SELF = '00000000-0000-0000-0000-0000000000b1';
const STUB = '00000000-0000-0000-0000-0000000000b2';

function makeService(opts: {
  trustMode: 'cautious' | 'balanced' | 'hands_off';
  stubs?: Array<{ entity_id: string; name: string | null; properties: Record<string, unknown> }>;
}) {
  const stubs = opts.stubs ?? [
    {
      entity_id: STUB,
      name: 'Bennett',
      properties: { emails: ['owner@example.com'] },
    },
  ];

  const query = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT entity_id FROM ci.users')) {
      return [{ entity_id: SELF }];
    }

    if (sql.includes('FROM ci.users u')) {
      return [
        { name: 'Bennett', email: 'owner@example.com', phones_json: null },
        { name: 'Bennett', email: null, phones_json: [] },
      ];
    }

    if (sql.includes('FROM ci.entities') && sql.includes('entity_id <>')) {
      return stubs;
    }

    return [];
  });

  const personMerge = { mergePeople: jest.fn(async () => ({ sourcesMerged: 1 })) };
  const mergeBlocks = { blockedPairsAmong: jest.fn(async () => new Set()) };
  const personalization = {
    getTrustMode: jest.fn(async () => opts.trustMode),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

  return {
    service: new HealSelfCollationService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { query } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      personMerge as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mergeBlocks as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      personalization as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger as any,
    ),
    personMerge,
    query,
  };
}

describe('HealSelfCollationService', () => {
  it('merges exact owner email stubs into self under hands_off', async () => {
    const { service, personMerge } = makeService({ trustMode: 'hands_off' });

    const result = await service.heal(USER);

    expect(result.examined).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.mergedSourceIds).toEqual([STUB]);
    expect(personMerge.mergePeople).toHaveBeenCalledWith({ userId: USER }, [STUB], SELF);
  });

  it('does not silent-merge under balanced — surfaces as reviewed', async () => {
    const { service, personMerge } = makeService({ trustMode: 'balanced' });

    const result = await service.heal(USER);

    expect(result.merged).toBe(0);
    expect(result.reviewed).toBe(1);
    expect(personMerge.mergePeople).not.toHaveBeenCalled();
  });

  it('is idempotent when no owner stubs remain', async () => {
    const { service, personMerge } = makeService({ trustMode: 'hands_off', stubs: [] });

    const first = await service.heal(USER);
    const second = await service.heal(USER);

    expect(first.examined).toBe(0);
    expect(second.examined).toBe(0);
    expect(personMerge.mergePeople).not.toHaveBeenCalled();
  });

  it('honours dryRun without calling mergePeople', async () => {
    const { service, personMerge } = makeService({ trustMode: 'hands_off' });

    const result = await service.heal(USER, { dryRun: true });

    expect(result.merged).toBe(1);
    expect(personMerge.mergePeople).not.toHaveBeenCalled();
  });
});
