import { type UserServiceContext } from '@ci/common/context';

import { type Ask } from '../entities/AskEntity';
import type { CreateAskDto } from '../types';

import { AskService } from './AskService';

const CTX: UserServiceContext = { userId: 'asker-1' };

const DTO: CreateAskDto = {
  responderUserId: 'responder-1',
  query: { queryType: 'photos', prompt: 'do you have photos of us?' },
};

function fakeAsk(overrides: Partial<Ask> = {}): Ask {
  return {
    id: 'ask-1',
    askerUserId: 'asker-1',
    responderUserId: 'responder-1',
    query: DTO.query,
    status: 'delivered',
    consentBasis: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    expiresAt: null,
    ...overrides,
  } as Ask;
}

function makeService() {
  const grantService = { evaluate: jest.fn() };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { setContext: jest.fn() };
  const service = new AskService(
    {} as never, // repository — create/systemTransition/setConsentBasis are spied
    grantService as never,
    auditService as never,
    logger as never,
  );

  return { service, grantService, auditService };
}

describe('AskService.submit — grant decision wiring', () => {
  it('auto-declines and audits when a block grant denies the ask', async () => {
    const { service, grantService, auditService } = makeService();
    grantService.evaluate.mockResolvedValue({ decision: 'deny', grantId: 'grant-block' });
    jest.spyOn(service, 'create').mockResolvedValue(fakeAsk());
    const declined = fakeAsk({ status: 'declined', consentBasis: 'grant-block' });
    const sysSpy = jest.spyOn(service, 'systemTransition').mockResolvedValue(declined);

    const result = await service.submit(CTX, DTO);

    expect(sysSpy).toHaveBeenCalledWith('ask-1', 'declined', { consentBasis: 'grant-block' });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ askId: 'ask-1', outcome: 'declined', consentBasis: 'grant-block' }),
    );
    expect(result).toEqual({ ask: declined, decision: 'deny' });
  });

  it('records the consent basis and leaves the ask delivered when auto-authorized', async () => {
    const { service, grantService, auditService } = makeService();
    grantService.evaluate.mockResolvedValue({ decision: 'auto', grantId: 'grant-auto' });
    jest.spyOn(service, 'create').mockResolvedValue(fakeAsk());
    const preauth = fakeAsk({ consentBasis: 'grant-auto' });
    const consentSpy = jest.spyOn(service, 'setConsentBasis').mockResolvedValue(preauth);
    const sysSpy = jest.spyOn(service, 'systemTransition');

    const result = await service.submit(CTX, DTO);

    expect(consentSpy).toHaveBeenCalledWith('ask-1', 'grant-auto');
    expect(sysSpy).not.toHaveBeenCalled(); // stays delivered for the executor
    expect(auditService.record).not.toHaveBeenCalled(); // no terminal outcome yet
    expect(result).toEqual({ ask: preauth, decision: 'auto' });
  });

  it('routes to the owner review inbox when no grant matches', async () => {
    const { service, grantService, auditService } = makeService();
    grantService.evaluate.mockResolvedValue({ decision: 'review' });
    jest.spyOn(service, 'create').mockResolvedValue(fakeAsk());
    const inboxed = fakeAsk({ status: 'under_review' });
    const sysSpy = jest.spyOn(service, 'systemTransition').mockResolvedValue(inboxed);

    const result = await service.submit(CTX, DTO);

    expect(sysSpy).toHaveBeenCalledWith('ask-1', 'under_review');
    expect(auditService.record).not.toHaveBeenCalled();
    expect(result).toEqual({ ask: inboxed, decision: 'review' });
  });
});

function mutableEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ask-1',
    askerUserId: 'asker-1',
    responderUserId: 'responder-1',
    query: DTO.query,
    status: 'answering',
    consentBasis: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    expiresAt: null,
    ...overrides,
  };
}

function makeServiceWithRepo(entity: Record<string, unknown>) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(entity),
    save: jest.fn().mockImplementation((e: unknown) => Promise.resolve(e)),
  };
  const grantService = { evaluate: jest.fn() };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { setContext: jest.fn() };
  const service = new AskService(
    repo as never,
    grantService as never,
    auditService as never,
    logger as never,
  );

  return { service, repo, auditService };
}

const OWNER: UserServiceContext = { userId: 'responder-1' };

describe('AskService.complete', () => {
  it('finalizes an owner-approved ask to answered and audits it', async () => {
    const entity = mutableEntity({ status: 'answering' });
    const { service, auditService } = makeServiceWithRepo(entity);

    const result = await service.complete(OWNER, 'ask-1', ['e1', 'e2']);

    expect(result.status).toBe('answered');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'answered', disclosedEntities: ['e1', 'e2'] }),
    );
  });

  it('finalizes an auto-authorized (delivered + consent) ask as auto_answered', async () => {
    const entity = mutableEntity({ status: 'delivered', consentBasis: 'grant-auto' });
    const { service, auditService } = makeServiceWithRepo(entity);

    const result = await service.complete(OWNER, 'ask-1', []);

    expect(result.status).toBe('answered'); // delivered → answering → answered
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'auto_answered' }));
  });

  it('refuses to complete an ask that is not yet answerable', async () => {
    const entity = mutableEntity({ status: 'under_review' });
    const { service, auditService } = makeServiceWithRepo(entity);

    await expect(service.complete(OWNER, 'ask-1', [])).rejects.toThrow();
    expect(auditService.record).not.toHaveBeenCalled();
  });
});

function makeServiceForCreate() {
  const repo = {
    create: jest.fn().mockImplementation((data: Record<string, unknown>) => data),
    save: jest.fn().mockImplementation((entity: Record<string, unknown>) => Promise.resolve(entity)),
  };
  const logger = { setContext: jest.fn() };
  const service = new AskService(repo as never, {} as never, {} as never, logger as never);

  return { service, repo };
}

describe('AskService.create — the self-ask guard', () => {
  it('refuses an ask a user directs at themselves', async () => {
    const { service, repo } = makeServiceForCreate();
    const self: UserServiceContext = { userId: 'user-1' };

    await expect(service.create(self, { ...DTO, responderUserId: 'user-1' })).rejects.toThrow(
      'An ask must be directed at another user',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('allows an ask directed at a different user', async () => {
    const { service } = makeServiceForCreate();

    await expect(service.create(CTX, DTO)).resolves.toMatchObject({
      askerUserId: 'asker-1',
      responderUserId: 'responder-1',
      status: 'delivered',
    });
  });
});

/**
 * A minimal, FAITHFUL in-memory stand-in for the TypeORM repository — not a
 * hand-picked fixture per test. `findOne`/`find` implement the actual semantics
 * of the `where` shape AskService passes (an array of clauses is OR'd, an
 * object's keys are AND'd), the same way TypeORM itself interprets it. That
 * makes this a real test of the tenancy predicate AskService builds — a swapped
 * field, a missing OR branch, or an AND where an OR belongs would misbehave
 * here exactly as it would against Postgres, rather than only against whatever
 * a narrower mock was told to return.
 */
interface FakeRow {
  id: string;
  askerUserId: string;
  responderUserId: string;
  status: string;
  createdAt: Date;
  [key: string]: unknown;
}

function matchesClause(row: FakeRow, clause: Record<string, unknown>): boolean {
  return Object.entries(clause).every(([key, value]) => row[key] === value);
}

function matchesWhere(row: FakeRow, where: Record<string, unknown> | Record<string, unknown>[]): boolean {
  return Array.isArray(where)
    ? where.some((clause) => matchesClause(row, clause))
    : matchesClause(row, where);
}

function fakeAskRepository(rows: FakeRow[]) {
  return {
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> | Record<string, unknown>[] }) =>
        rows.find((row) => matchesWhere(row, where)) ?? null,
    ),
    find: jest.fn(
      async ({
        where,
        order,
      }: {
        where: Record<string, unknown> | Record<string, unknown>[];
        order?: Record<string, 'ASC' | 'DESC'>;
      }) => {
        const matched = rows.filter((row) => matchesWhere(row, where));

        return order?.createdAt === 'DESC'
          ? [...matched].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          : matched;
      },
    ),
  };
}

function fakeAskRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'ask-x',
    askerUserId: 'asker',
    responderUserId: 'responder',
    query: DTO.query,
    status: 'delivered',
    consentBasis: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    expiresAt: null,
    ...overrides,
  };
}

// The tenancy/privacy boundary the audit flagged: "an ask is visible to its
// asker and its responder only". A regression here lets an unrelated third
// user read another pair's ask, so the case that matters is not "the right
// user gets it" but "everyone else does NOT".
describe('AskService.findById — participant-only visibility', () => {
  it('is visible to the asker', async () => {
    const ask = fakeAskRow({ id: 'ask-1', askerUserId: 'alice', responderUserId: 'bob' });
    const repo = fakeAskRepository([ask]);
    const service = new AskService(
      repo as never,
      {} as never,
      {} as never,
      { setContext: jest.fn() } as never,
    );

    await expect(service.findById({ userId: 'alice' }, 'ask-1')).resolves.toMatchObject({ id: 'ask-1' });
  });

  it('is visible to the responder', async () => {
    const ask = fakeAskRow({ id: 'ask-1', askerUserId: 'alice', responderUserId: 'bob' });
    const repo = fakeAskRepository([ask]);
    const service = new AskService(
      repo as never,
      {} as never,
      {} as never,
      { setContext: jest.fn() } as never,
    );

    await expect(service.findById({ userId: 'bob' }, 'ask-1')).resolves.toMatchObject({ id: 'ask-1' });
  });

  it('is NOT visible to an unrelated third user, even one who is a participant on a DIFFERENT ask', async () => {
    const ask = fakeAskRow({ id: 'ask-1', askerUserId: 'alice', responderUserId: 'bob' });
    // 'carol' is a legitimate participant, just on an unrelated ask — proves the
    // check is scoped to THIS ask's id, not merely "is carol a participant of
    // anything".
    const otherAsk = fakeAskRow({ id: 'ask-2', askerUserId: 'carol', responderUserId: 'dave' });
    const repo = fakeAskRepository([ask, otherAsk]);
    const service = new AskService(
      repo as never,
      {} as never,
      {} as never,
      { setContext: jest.fn() } as never,
    );

    await expect(service.findById({ userId: 'carol' }, 'ask-1')).resolves.toBeNull();
    await expect(service.findById({ userId: 'dave' }, 'ask-1')).resolves.toBeNull();
    await expect(service.findById({ userId: 'someone-else' }, 'ask-1')).resolves.toBeNull();
  });
});

describe('AskService.listInbox — responder-scoped review queue', () => {
  it("lists only the responder's own delivered / under_review asks, newest first", async () => {
    const mine1 = fakeAskRow({
      id: 'inbox-1',
      responderUserId: 'bob',
      status: 'delivered',
      createdAt: new Date('2026-07-15T00:00:00Z'),
    });
    const mine2 = fakeAskRow({
      id: 'inbox-2',
      responderUserId: 'bob',
      status: 'under_review',
      createdAt: new Date('2026-07-16T00:00:00Z'),
    });
    // Terminal — must NOT appear in the review inbox even though bob responds.
    const answered = fakeAskRow({ id: 'inbox-3', responderUserId: 'bob', status: 'answered' });
    // A DIFFERENT responder's pending ask — the tenancy case: must not leak
    // into bob's inbox.
    const someoneElses = fakeAskRow({ id: 'inbox-4', responderUserId: 'carol', status: 'delivered' });

    const repo = fakeAskRepository([mine1, mine2, answered, someoneElses]);
    const service = new AskService(
      repo as never,
      {} as never,
      {} as never,
      { setContext: jest.fn() } as never,
    );

    const inbox = await service.listInbox({ userId: 'bob' });

    expect(inbox.map((a) => a.id)).toEqual(['inbox-2', 'inbox-1']); // newest first
  });
});

describe('AskService.listOutbox — asker-scoped sent history', () => {
  it("lists only the asker's own asks, regardless of status", async () => {
    const mine = fakeAskRow({ id: 'out-1', askerUserId: 'alice', status: 'answered' });
    // Someone else's ask, even to the same responder — must not leak.
    const someoneElses = fakeAskRow({
      id: 'out-2',
      askerUserId: 'eve',
      responderUserId: mine.responderUserId,
    });

    const repo = fakeAskRepository([mine, someoneElses]);
    const service = new AskService(
      repo as never,
      {} as never,
      {} as never,
      { setContext: jest.fn() } as never,
    );

    const outbox = await service.listOutbox({ userId: 'alice' });

    expect(outbox.map((a) => a.id)).toEqual(['out-1']);
  });
});
