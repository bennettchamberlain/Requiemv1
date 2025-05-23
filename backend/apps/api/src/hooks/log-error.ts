import type { HookContext, NextFunction } from '@feathersjs/feathers';

import { Logger } from '../utils';

const logger = Logger.create('error');

export async function logError(context: HookContext, next: NextFunction) {
  try {
    await next();
  } catch (err) {
    if (err instanceof Error) {
      logger.error(err.stack);
    }

    throw err;
  }
}
