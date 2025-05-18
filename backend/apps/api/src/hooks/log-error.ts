import type { HookContext, NextFunction } from '@feathersjs/feathers';

import { LoggingService } from '../logging';

const logger = LoggingService.create('error');

export async function logError(context: HookContext, next: NextFunction) {
  try {
    await next();
  } catch (error: any) {
    logger.error(error.stack);

    // Log validation errors
    if (error.data) {
      logger.error('Data: %O', error.data);
    }

    throw error;
  }
}
