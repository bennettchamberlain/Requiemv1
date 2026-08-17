import { Cron as NestCron, type CronOptions } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';

import { ContextService } from '@ci/common/context';
import { serves, type ServedRole } from '@ci/common/roles';

export type CiCronOptions = CronOptions & {
  /**
   * Which process runs this cron. Defaults to `web` — the process a
   * single-role deployment always has — so only crons that explicitly belong
   * to the queue worker (the import purge, the resume sweep) move. When this
   * process does not serve the role, the method simply never registers with
   * the scheduler: same class, same code, silent in the other process.
   */
  role?: ServedRole;
};

export function Cron(expression: string, options?: CiCronOptions) {
  const { role = 'web', ...cronOptions } = options ?? {};

  return function (target: object, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const traceId = uuidv4();

      return ContextService.run({ traceId }, () => originalMethod.apply(this, args));
    };

    if (!serves(role)) {
      return descriptor;
    }

    return NestCron(expression, cronOptions)(target, propertyName, descriptor);
  };
}
