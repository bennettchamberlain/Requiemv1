import { BadRequestException } from '@nestjs/common';

import { DOCTOR_CHECKS } from '../../doctor/checks';
import { ImportDoctorController, parseCheckIds } from '../ImportDoctorController';

/**
 * A thin surface over ImportDoctorService — the timeout mechanics and the gate
 * are pinned in that service's own spec. What belongs to the controller is the
 * contract at its edge: the registry is published without its SQL, the `checks`
 * filter is validated rather than silently ignored, and a nonsense `timeoutMs`
 * falls back to the default instead of disabling the cap.
 */
function build() {
  const run = jest.fn(async () => ({ ok: true }) as never);

  return { controller: new ImportDoctorController({ run } as never), run };
}

describe('ImportDoctorController', () => {
  it('publishes the registry without the SQL', () => {
    const { controller } = build();
    const checks = controller.listChecks();

    expect(checks).toHaveLength(DOCTOR_CHECKS.length);
    // Stripped deliberately: it would double the payload, and a caller that
    // wants a predicate reads checks.ts, where the comment explaining it lives.
    expect(checks.every((check) => !('sql' in check))).toBe(true);
    expect(checks[0]).toMatchObject({ id: expect.any(String), severity: expect.any(String) });
  });

  it('runs everything when no filter is given', async () => {
    const { controller, run } = build();

    await controller.run();

    expect(run).toHaveBeenCalledWith({ checks: undefined, statementTimeoutMs: undefined });
  });

  it('passes a validated subset and timeout through', async () => {
    const { controller, run } = build();

    await controller.run('pipeline-dead-letters, person-duplicate-names', '60000');

    expect(run).toHaveBeenCalledWith({
      checks: ['pipeline-dead-letters', 'person-duplicate-names'],
      statementTimeoutMs: 60_000,
    });
  });

  it('falls back to the default cap when timeoutMs is not a number', async () => {
    // Rather than passing NaN down, where it would be clamped anyway — the
    // service owns the default, and sending it undefined is how the controller
    // says "no opinion" instead of "this value".
    const { controller, run } = build();

    await controller.run(undefined, 'thirty seconds');

    expect(run).toHaveBeenCalledWith({ checks: undefined, statementTimeoutMs: undefined });
  });
});

describe('parseCheckIds', () => {
  it('treats an absent or empty filter as no filter at all', () => {
    // Distinct from an empty array, which would be a filter matching NOTHING —
    // never what a caller means by an empty query string.
    expect(parseCheckIds(undefined)).toBeUndefined();
    expect(parseCheckIds('')).toBeUndefined();
    expect(parseCheckIds(' , ')).toBeUndefined();
  });

  it('rejects an unknown id and says which ones, plus the whole vocabulary', () => {
    // The caller most likely to send one is an agent working from a
    // half-remembered id; naming it and listing the real ones is a fix, where a
    // silent empty result is a wild goose chase.
    let thrown: unknown;

    try {
      parseCheckIds('comms-null-thread,pipeline-dead-letters');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);

    const [unknown, known] = (thrown as Error).message.split('. Known ids: ');

    // Only the bad id is called unknown; the good one it was sent alongside is
    // not swept up with it.
    expect(unknown).toBe('Unknown check id(s): comms-null-thread');
    expect(known).toContain('comms-missing-thread-id');
    expect(known).toContain('pipeline-dead-letters');
  });
});
