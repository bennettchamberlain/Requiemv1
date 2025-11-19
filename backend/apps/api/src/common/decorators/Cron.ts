import { Cron as NestCron, type CronOptions } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';

import { RequestContextService } from '../services/RequestContextService';

export function Cron(expression: string, options?: CronOptions) {
  return function (target: object, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const traceId = uuidv4();

      return RequestContextService.run({ traceId }, () => originalMethod.apply(this, args));
    };

    return NestCron(expression, options)(target, propertyName, descriptor);
  };
}
