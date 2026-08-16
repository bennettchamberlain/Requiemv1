import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';

import config from '@ci/configuration';

import { Cron } from '../decorators/Cron';

/**
 * Role-gated cron registration. The mechanism is deliberately blunt: when a
 * process does not serve a cron's role, the wrapper never hands the method to
 * Nest's scheduler — same class, same code, silent in the other process. What
 * must hold: a worker cron registers under `worker` and `all` but NOT under
 * `web`, and an unmarked cron defaults to web.
 */

function defineUnderRole(role: 'all' | 'web' | 'worker', cronRole?: 'web' | 'worker') {
  const previous = config.role;

  (config as { role: string }).role = role;

  try {
    class Probe {
      @Cron('0 0 * * * *', cronRole == null ? undefined : { role: cronRole })
      async tick(): Promise<void> {
        /* registration is the subject, not execution */
      }
    }

    return Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, Probe.prototype.tick) != null;
  } finally {
    (config as { role: string }).role = previous;
  }
}

describe('Cron role gating', () => {
  it('a worker cron registers under worker and all, never under web', () => {
    expect(defineUnderRole('worker', 'worker')).toBe(true);
    expect(defineUnderRole('all', 'worker')).toBe(true);
    expect(defineUnderRole('web', 'worker')).toBe(false);
  });

  it('an unmarked cron defaults to web: registers under web and all, never under worker', () => {
    expect(defineUnderRole('web')).toBe(true);
    expect(defineUnderRole('all')).toBe(true);
    expect(defineUnderRole('worker')).toBe(false);
  });
});
