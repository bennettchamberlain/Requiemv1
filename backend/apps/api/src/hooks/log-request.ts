// src/hooks/requestLogger.ts

import { HookContext, NextFunction } from '@feathersjs/feathers';

import { LoggingService } from '../logging';

const logger = LoggingService.create('request');

export async function logRequest(context: HookContext, next: NextFunction) {
  const start = process.hrtime.bigint();

  const { method, path } = context;

  try {
    await next();
  } finally {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;

    logger.info({
      method,
      path,
      durationMs,
    });
  }
}
