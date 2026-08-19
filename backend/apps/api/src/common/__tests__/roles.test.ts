import config from '@ci/configuration';

import { processRole, serves } from '../roles';

/**
 * The role truth table the whole split-topology rests on. `all` serving both
 * halves is what keeps every existing test and standalone `yarn dev` running
 * unchanged — a regression here silently strands either the web's crons or
 * the worker's queues.
 */

function withRole<T>(role: 'all' | 'web' | 'worker', run: () => T): T {
  const previous = config.role;

  (config as { role: string }).role = role;

  try {
    return run();
  } finally {
    (config as { role: string }).role = previous;
  }
}

describe('serves', () => {
  it('all serves both halves — the single-process default', () => {
    withRole('all', () => {
      expect(processRole()).toBe('all');
      expect(serves('web')).toBe(true);
      expect(serves('worker')).toBe(true);
    });
  });

  it('web serves web only', () => {
    withRole('web', () => {
      expect(serves('web')).toBe(true);
      expect(serves('worker')).toBe(false);
    });
  });

  it('worker serves worker only', () => {
    withRole('worker', () => {
      expect(serves('web')).toBe(false);
      expect(serves('worker')).toBe(true);
    });
  });
});
