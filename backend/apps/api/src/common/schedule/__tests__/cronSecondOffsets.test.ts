import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';

import { ActivityRollupCron } from '@ci/domains/activity/cron/ActivityRollupCron';
import { MemoryCompactionCron } from '@ci/domains/agent/cron/MemoryCompactionCron';
import { InitialActionsCron } from '@ci/domains/onboarding/cron/InitialActionsCron';

/**
 * Second-of-minute placement, which is a scheduling decision and not a style
 * one. `@nestjs/schedule` timers are in-process, so everything left on second 0
 * fires into the same event loop and the same 25-connection pool at once. These
 * three are the expensive members of that pile-up — eight full-table aggregates,
 * a 100-fragment LLM batch and a per-user onboarding fan-out — so each takes a
 * second nobody else holds.
 *
 * The assertions read the metadata Nest's scheduler is actually handed, not the
 * source constants, so a `@Cron` rewritten back to `CronExpression.EVERY_*`
 * fails here too.
 */

/** Seconds claimed by crons that were already offset before this invariant existed. */
const PREEXISTING_OFFSETS: Record<string, string> = {
  '10': 'PipelineControlService.tickOnSchedule',
  '20': 'PipelineTickCron.runOnSchedule',
  '30': 'ImportStageListener.sweepOnSchedule',
  '40': 'DeadLetterReaperListener.reapOnSchedule',
};

function registeredExpression(method: unknown): string {
  const options = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method as object) as
    | { cronTime?: string }
    | undefined;

  expect(options?.cronTime).toEqual(expect.any(String));

  return options?.cronTime as string;
}

function fields(expression: string): string[] {
  const parts = expression.trim().split(/\s+/);

  // Five fields means no seconds field at all, which `cron` reads as second 0 —
  // the pile-up this test exists to prevent.
  expect(parts).toHaveLength(6);

  return parts;
}

const SUBJECTS = [
  {
    name: 'ActivityRollupCron.refreshRollup',
    method: ActivityRollupCron.prototype.refreshRollup,
    cadence: '*/15 * * * *',
  },
  {
    name: 'MemoryCompactionCron.cronCompactMemories',
    method: MemoryCompactionCron.prototype.cronCompactMemories,
    cadence: '*/5 * * * *',
  },
  {
    name: 'InitialActionsCron.initializeEligibleUsers',
    method: InitialActionsCron.prototype.initializeEligibleUsers,
    cadence: '0 * * * *',
  },
] as const;

describe('cron second offsets', () => {
  it.each(SUBJECTS)('$name fires off second 0', ({ method }) => {
    const [seconds] = fields(registeredExpression(method));

    expect(seconds).toMatch(/^\d+$/);
    expect(seconds).not.toBe('0');
  });

  it.each(SUBJECTS)('$name keeps its cadence', ({ method, cadence }) => {
    expect(fields(registeredExpression(method)).slice(1).join(' ')).toBe(cadence);
  });

  it('gives each of them a second no other cron holds', () => {
    const claimed = new Map<string, string>(Object.entries(PREEXISTING_OFFSETS));

    for (const { name, method } of SUBJECTS) {
      const [seconds] = fields(registeredExpression(method));
      const holder = claimed.get(seconds);

      expect(holder == null ? null : `${name} collides with ${holder} on second ${seconds}`).toBeNull();

      claimed.set(seconds, name);
    }
  });
});
