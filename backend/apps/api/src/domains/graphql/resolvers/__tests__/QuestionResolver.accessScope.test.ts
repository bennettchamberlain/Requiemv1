import { SYSTEM_USER, type RequestContext } from '@ci/common/context';
import { QuestionEntity, QuestionService } from '@ci/domains/intelligence';

import { GlobalUID } from '../../types/GlobalUID';
import { QuestionResolver } from '../QuestionResolver';

/**
 * Who may write to the shared reflection catalogue, pinned at the GraphQL edge.
 *
 * `ci.questions` is two things in one table: ~1.3k shared rows (`is_private_to
 * IS NULL`) that EVERY user on the appliance is asked from, seeded by migration
 * as `is_seed_question = true, created_by_llm = false`; and each person's own
 * private reflections. When the browsable catalogue shipped, the service's write
 * scope was widened to match its read scope, so any authenticated user could
 * reword, recategorise or retire a shared row and the change landed on the one
 * shared row — silently changing what everybody else gets asked.
 *
 * These tests run the real {@link QuestionService} over an in-memory store that
 * honours its `where` clauses, rather than a stubbed service: a mocked service
 * would assert only that the resolver forwards arguments, which pins nothing
 * about access at all.
 *
 * The rule, end to end:
 *  - a shared row is READ-ONLY to an ordinary caller. `updateQuestion` copies it
 *    into a private row owned by the caller and edits that;
 *  - `removeQuestion` does NOT copy and is NOT widened — ci.answers and
 *    ci.feed_queue both cascade from ci.questions, so hard-deleting a shared row
 *    would take other people's answers with it;
 *  - another user's private row remains invisible and unwritable, as before.
 */

const USER = '00000000-0000-0000-0000-0000000000aa';
const OTHER_USER = '00000000-0000-0000-0000-0000000000bb';

const CONTEXT = { userId: USER } as RequestContext;
const OTHER_CONTEXT = { userId: OTHER_USER } as RequestContext;

const SEED_ID = '00000000-0000-0000-0000-0000000000f1';
const MINE_ID = '00000000-0000-0000-0000-0000000000f2';
const THEIRS_ID = '00000000-0000-0000-0000-0000000000f3';

type Clause = Record<string, unknown>;
type FindOperatorLike = { _type: string; _value?: unknown };

function isFindOperator(value: unknown): value is FindOperatorLike {
  return typeof value === 'object' && value !== null && '_type' in value;
}

function matchesClause(row: QuestionEntity, clause: Clause): boolean {
  return Object.entries(clause).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];

    if (isFindOperator(expected)) {
      if (expected._type === 'isNull') {
        return actual === null || actual === undefined;
      }

      if (expected._type === 'not') {
        const inner = expected._value;

        return isFindOperator(inner) && inner._type === 'isNull'
          ? actual !== null && actual !== undefined
          : actual !== inner;
      }

      if (expected._type === 'in') {
        return Array.isArray(expected._value) && expected._value.includes(actual);
      }

      return false;
    }

    return actual === expected;
  });
}

function matchesWhere(row: QuestionEntity, where: Clause | Clause[]): boolean {
  return (Array.isArray(where) ? where : [where]).some((clause) => matchesClause(row, clause));
}

function question(id: string, overrides: Partial<QuestionEntity> = {}): QuestionEntity {
  return Object.assign(new QuestionEntity(), {
    id,
    text: `question-${id}`,
    category: 'Health & Body',
    isActive: true,
    isSeedQuestion: false,
    createdByLlm: false,
    isPrivateTo: null,
    forkedFromQuestionId: null,
    ...overrides,
  });
}

/** The shipped catalogue: shared with the whole appliance, human-written. */
function seedRow(): QuestionEntity {
  return question(SEED_ID, { isSeedQuestion: true, isPrivateTo: null });
}

function makeResolver(rows: QuestionEntity[]) {
  const repository = {
    find: jest.fn(async ({ where }: { where: Clause | Clause[] }) =>
      rows.filter((row) => matchesWhere(row, where)),
    ),
    findOne: jest.fn(
      async ({ where }: { where: Clause | Clause[] }) => rows.find((row) => matchesWhere(row, where)) ?? null,
    ),
    create: jest.fn((partial: Partial<QuestionEntity>) => Object.assign(new QuestionEntity(), partial)),
    save: jest.fn(async (entity: QuestionEntity) => {
      if (!rows.includes(entity)) {
        rows.push(entity);
      }

      return entity;
    }),
    delete: jest.fn(async () => ({ affected: 1 })),
    metadata: { target: QuestionEntity, columns: { length: 15 } },
  };

  const dataSource = { query: jest.fn(async () => []) };
  const eventService = { send: jest.fn(async () => []) };

  const service = new QuestionService(dataSource as never, repository as never, eventService as never);

  return { resolver: new QuestionResolver(service), service, rows, repository };
}

describe('QuestionResolver write scope on the shared catalogue', () => {
  it('does not let one user reword a shared row for everybody', async () => {
    const seed = seedRow();
    const { resolver, rows } = makeResolver([seed]);

    const result = await resolver.updateQuestion(CONTEXT, {
      id: GlobalUID.encode('question', SEED_ID),
      text: 'my own wording',
      category: 'Health & Body',
    });

    // The shared row is exactly as it was.
    expect(seed.text).toBe(`question-${SEED_ID}`);
    expect(seed.isPrivateTo).toBeNull();

    // The caller got a private copy carrying their edit.
    expect(result).not.toBeNull();
    expect(GlobalUID.decode(result!.id).id).not.toBe(SEED_ID);
    expect(result!.text).toBe('my own wording');
    expect(rows).toHaveLength(2);
    expect(rows[1].isPrivateTo).toBe(USER);
    expect(rows[1].forkedFromQuestionId).toBe(SEED_ID);
  });

  it("leaves another user's view of the shared catalogue untouched", async () => {
    const seed = seedRow();
    const { resolver, service } = makeResolver([seed]);

    await resolver.updateQuestion(CONTEXT, {
      id: GlobalUID.encode('question', SEED_ID),
      text: 'my own wording',
      category: 'Health & Body',
    });

    const theirs = await service.findAll({ userId: OTHER_USER });

    expect(theirs.map((entry) => entry.id)).toEqual([SEED_ID]);
    expect(theirs[0].text).toBe(`question-${SEED_ID}`);
  });

  it("still edits the caller's own private reflection in place", async () => {
    const mine = question(MINE_ID, { isPrivateTo: USER });
    const { resolver, rows } = makeResolver([mine]);

    const result = await resolver.updateQuestion(CONTEXT, {
      id: GlobalUID.encode('question', MINE_ID),
      text: 'reworded',
      category: 'Health & Body',
    });

    expect(GlobalUID.decode(result!.id).id).toBe(MINE_ID);
    expect(mine.text).toBe('reworded');
    expect(rows).toHaveLength(1);
  });

  it("refuses to write to another user's private reflection", async () => {
    const theirs = question(THEIRS_ID, { isPrivateTo: OTHER_USER });
    const { resolver, rows } = makeResolver([theirs]);

    const result = await resolver.updateQuestion(CONTEXT, {
      id: GlobalUID.encode('question', THEIRS_ID),
      text: 'hijacked',
      category: 'Health & Body',
    });

    expect(result).toBeNull();
    expect(theirs.text).toBe(`question-${THEIRS_ID}`);
    expect(rows).toHaveLength(1);
  });

  it('refuses to delete a shared catalogue row, which would cascade to answers', async () => {
    const { resolver, repository } = makeResolver([seedRow()]);

    const removed = await resolver.removeQuestion(CONTEXT, GlobalUID.encode('question', SEED_ID));

    expect(removed).toBe(false);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete another user's private reflection", async () => {
    const { resolver, repository } = makeResolver([question(THEIRS_ID, { isPrivateTo: OTHER_USER })]);

    const removed = await resolver.removeQuestion(CONTEXT, GlobalUID.encode('question', THEIRS_ID));

    expect(removed).toBe(false);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("still deletes the caller's own private reflection", async () => {
    const { resolver, repository } = makeResolver([question(MINE_ID, { isPrivateTo: USER })]);

    const removed = await resolver.removeQuestion(CONTEXT, GlobalUID.encode('question', MINE_ID));

    expect(removed).toBe(true);
    expect(repository.delete).toHaveBeenCalled();
  });

  it('gives each user their own copy, so two edits do not fight over one row', async () => {
    const seed = seedRow();
    const { resolver, rows } = makeResolver([seed]);
    const gid = GlobalUID.encode('question', SEED_ID);

    const mine = await resolver.updateQuestion(CONTEXT, {
      id: gid,
      text: 'mine',
      category: 'Health & Body',
    });
    const theirs = await resolver.updateQuestion(OTHER_CONTEXT, {
      id: gid,
      text: 'theirs',
      category: 'Health & Body',
    });

    expect(mine!.id).not.toBe(theirs!.id);
    expect(mine!.text).toBe('mine');
    expect(theirs!.text).toBe('theirs');
    expect(seed.text).toBe(`question-${SEED_ID}`);
    expect(rows).toHaveLength(3);
  });

  it('creates a new reflection private to its author, not into the shared catalogue', async () => {
    const { resolver, rows } = makeResolver([]);

    await resolver.createQuestion(CONTEXT, {
      text: 'What is my landlord called?',
      category: 'Home & Places',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].isPrivateTo).toBe(USER);
  });

  it('leaves a system caller able to edit shared rows in place, for migrations and cron', async () => {
    const seed = seedRow();
    const { service, rows } = makeResolver([seed]);

    const result = await service.update({ userId: SYSTEM_USER }, SEED_ID, { text: 'corrected' });

    expect(result?.id).toBe(SEED_ID);
    expect(seed.text).toBe('corrected');
    expect(rows).toHaveLength(1);
  });
});
