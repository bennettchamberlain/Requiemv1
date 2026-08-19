import { JobQueryService } from '../JobQueryService';

/**
 * Regression guard for the `stateCounts` bucket expression.
 *
 * The Jobs table returned a 500 for every request — "invalid input value for
 * enum pgboss.job_state: dead-letter" — while the dashboard summary above it
 * rendered fine. The cause is a Postgres typing rule rather than a logic error:
 * a CASE unifies its branches to a single type, so
 *
 *   CASE WHEN job.name = 'dead-letter' THEN 'dead-letter' ELSE job.state END
 *
 * takes the ENUM type from the ELSE branch and then tries to coerce the literal
 * into it. `dead-letter` is a QUEUE name, never a member of `pgboss.job_state`,
 * so the query dies at parse time.
 *
 * The rest of the service already handled the synthetic state correctly, which
 * is why this survived review — and the other specs in this folder mock the
 * query builder, so the SQL is never executed and a mocked test cannot catch it.
 * Asserting on the emitted expression is the cheapest guard that actually binds.
 */
describe('JobQueryService.stateCounts — bucket expression', () => {
  function captureSelect(): { select: string } {
    const captured = { select: '' };

    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    Object.assign(builder, {
      select: jest.fn((expression: string) => {
        captured.select = expression;

        return builder;
      }),
      addSelect: jest.fn(chain),
      setParameter: jest.fn(chain),
      groupBy: jest.fn(chain),
      andWhere: jest.fn(chain),
      where: jest.fn(chain),
      orWhere: jest.fn(chain),
      getRawMany: jest.fn().mockResolvedValue([]),
    });

    const repo = { createQueryBuilder: jest.fn(() => builder) };
    const service = new JobQueryService(repo as never, repo as never, repo as never);

    // stateCounts is private; exercising it through the public shape keeps the
    // test honest about what it is guarding.
    (service as unknown as { stateCounts: (q: unknown) => Promise<unknown> }).stateCounts({});

    return captured;
  }

  it('casts job.state to text so the CASE does not unify to the enum', () => {
    const { select } = captureSelect();

    expect(select).toContain('CASE WHEN');
    // The cast is the fix. Without it Postgres coerces 'dead-letter' into
    // pgboss.job_state and the whole jobs list 500s.
    expect(select).toMatch(/job\.state::text/);
  });

  it("still buckets the dead-letter QUEUE under a synthetic 'dead-letter' label", () => {
    const { select } = captureSelect();

    expect(select).toContain("'dead-letter'");
    expect(select).toContain('job.name');
  });
});
