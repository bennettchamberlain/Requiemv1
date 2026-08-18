import type { UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { NodeService, RelationshipService } from '@ci/domains/graph';
import type { Person, PersonService } from '@ci/domains/memory';
import type { UserService } from '@ci/domains/user';

import { PromoteService } from '../PromoteService';

const CONTEXT = { userId: 'user-1' } as UserServiceContext;
const USER_NODE = { entityId: 'user-1-entity' };
const USER = { id: 'user-1', email: 'me@example.com', entityId: 'user-1-entity' };

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'person-generated',
    name: 'Someone',
    properties: {},
    ...overrides,
  } as unknown as Person;
}

function buildService(
  overrides: {
    personService?: Partial<PersonService>;
    userService?: Partial<UserService>;
    nodeService?: Partial<NodeService>;
  } = {},
) {
  let createCounter = 0;
  const personService = {
    findById: jest.fn().mockResolvedValue(makePerson({ id: USER_NODE.entityId })),
    search: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (_ctx, dto) => {
      createCounter += 1;

      return makePerson({
        id: dto.id ?? `created-${createCounter}`,
        name: dto.name,
        properties: dto.properties,
      });
    }),
    ...overrides.personService,
  } as unknown as PersonService;

  const userService = {
    findById: jest.fn().mockResolvedValue(USER),
    ...overrides.userService,
  } as unknown as UserService;

  const nodeService = {
    findNodeByUserId: jest.fn().mockResolvedValue(USER_NODE),
    ...overrides.nodeService,
  } as unknown as NodeService;

  const relationshipService = {} as unknown as RelationshipService;
  const eventService = {} as never;
  const connectionRepository = {} as never;
  const logger = { setContext() {}, log() {}, warn() {}, error() {} } as unknown as LoggerService;

  const service = new PromoteService(
    connectionRepository,
    eventService,
    personService,
    userService,
    nodeService,
    relationshipService,
    logger,
  );

  return { service, personService, userService, nodeService };
}

describe('PromoteService.upsertPeopleFromParticipants', () => {
  it("resolves the caller's own Person node by email match instead of creating a duplicate", async () => {
    const { service, personService } = buildService();

    const { entities, relationships } = await service.upsertPeopleFromParticipants(CONTEXT, {
      connectionId: 'conn-1',
      source: 'email',
      participants: [{ email: 'ME@Example.com', name: 'Me Myself' }],
    });

    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe(USER_NODE.entityId);
    expect(personService.create).not.toHaveBeenCalled();
    // The user's own entity is filtered out of the relationships list (nulled).
    expect(relationships).toEqual([null]);
  });

  it('reuses an existing Person found by email search instead of creating a new one', async () => {
    const existing = makePerson({ id: 'existing-person', name: 'Alice Existing' });
    const { service, personService } = buildService({
      personService: { search: jest.fn().mockResolvedValue([existing]) },
    });

    const { entities } = await service.upsertPeopleFromParticipants(CONTEXT, {
      connectionId: 'conn-1',
      source: 'email',
      participants: [{ email: 'alice@example.com', name: 'Alice' }],
    });

    expect(entities[0].id).toBe('existing-person');
    expect(personService.create).not.toHaveBeenCalled();
  });

  it('creates a new Person with a name split into first/last and source-stamped properties', async () => {
    const { service, personService } = buildService();

    await service.upsertPeopleFromParticipants(CONTEXT, {
      connectionId: 'conn-42',
      source: 'calendar',
      participants: [{ email: 'bob.jones@example.com', name: 'Bob Jones' }],
    });

    expect(personService.create).toHaveBeenCalledWith(
      CONTEXT,
      expect.objectContaining({
        name: 'Bob Jones',
        properties: expect.objectContaining({
          email: 'bob.jones@example.com',
          first_name: 'Bob',
          last_name: 'Jones',
          contact_type: 'calendar',
          owner_user_id: 'user-1',
          connection_id: 'conn-42',
        }),
      }),
    );
  });

  it('uses the full name as first_name and null last_name for a single-word name', async () => {
    const { service, personService } = buildService();

    await service.upsertPeopleFromParticipants(CONTEXT, {
      connectionId: 'conn-1',
      source: 'email',
      participants: [{ email: 'cher@example.com', name: 'Cher' }],
    });

    expect(personService.create).toHaveBeenCalledWith(
      CONTEXT,
      expect.objectContaining({
        properties: expect.objectContaining({ first_name: 'Cher', last_name: null }),
      }),
    );
  });

  /**
   * Regression coverage for a real dedup bug: the in-request `taskMap` cache
   * that exists specifically to stop concurrent duplicate creates for the same
   * participant email was keying its create-branch entries on the RAW
   * `participant.email` while every lookup (`taskMap.has`/`.get`) used the
   * lowercased `email`. Two participants whose raw email differed only by case
   * — or even the exact same raw email appearing twice — never hit the cache
   * on the second occurrence, so each got its own concurrent
   * search-then-create race and could produce duplicate Person rows for one
   * address in a single call (the same class of bug already fixed for
   * WhatsApp re-imports elsewhere in this codebase). Fixed by keying the
   * create-branch cache entry on the normalized `email` too.
   */
  it('dedupes concurrent participants that share an email but differ in case (in-request cache)', async () => {
    const { service, personService } = buildService();

    const { entities } = await service.upsertPeopleFromParticipants(CONTEXT, {
      connectionId: 'conn-1',
      source: 'email',
      participants: [
        { email: 'Dana@Example.com', name: 'Dana One' },
        { email: 'dana@example.com', name: 'Dana Two' },
      ],
    });

    expect(personService.create).toHaveBeenCalledTimes(1);
    expect(entities[0].id).toBe(entities[1].id);
  });

  it('dedupes the exact same participant email appearing twice in one call', async () => {
    const { service, personService } = buildService();

    const { entities } = await service.upsertPeopleFromParticipants(CONTEXT, {
      connectionId: 'conn-1',
      source: 'email',
      participants: [
        { email: 'repeat@example.com', name: 'Repeat Person' },
        { email: 'repeat@example.com', name: 'Repeat Person' },
      ],
    });

    expect(personService.create).toHaveBeenCalledTimes(1);
    expect(entities[0].id).toBe(entities[1].id);
  });

  it('creates distinct people for distinct emails and keeps entities/relationships aligned by index', async () => {
    const { service } = buildService();

    const { entities, relationships } = await service.upsertPeopleFromParticipants(CONTEXT, {
      connectionId: 'conn-1',
      source: 'email',
      participants: [
        { email: 'ME@Example.com', name: 'Me' },
        { email: 'other@example.com', name: 'Other Person' },
      ],
    });

    expect(entities).toHaveLength(2);
    expect(entities[0].id).toBe(USER_NODE.entityId);
    expect(entities[1].id).not.toBe(USER_NODE.entityId);
    // relationships mirrors entities index-for-index, nulling out only the user.
    expect(relationships[0]).toBeNull();
    expect(relationships[1]).toEqual(entities[1]);
  });

  it("throws when the caller's own graph node cannot be resolved", async () => {
    const { service } = buildService({
      personService: { findById: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.upsertPeopleFromParticipants(CONTEXT, {
        connectionId: 'conn-1',
        source: 'email',
        participants: [{ email: 'me@example.com', name: 'Me' }],
      }),
    ).rejects.toThrow('User graph node could not be obtained');
  });
});
