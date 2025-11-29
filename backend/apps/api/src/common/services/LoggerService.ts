import type { LoggerService as NestLoggerService } from '@nestjs/common';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';
import pino from 'pino';

import config from '@ci/configuration';

import { RequestContextService } from './RequestContextService';

type LogData = string | Record<string, unknown>;
type ErrorableLogData = Error | LogData;

interface PinoParams {
  obj: Record<string, unknown>;
  msg?: string;
}

const NEST_CONTEXT_DOWNGRADES = new Set([
  'InstanceLoader',
  'NestApplication',
  'NestFactory',
  'RouterExplorer',
  'RoutesResolver',
]);

export class LoggerService implements NestLoggerService {
  private logger: PinoLogger;

  constructor(name?: string, options?: LoggerOptions) {
    this.logger = pino({
      level: config.logging.level ?? 'debug',
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
      mixin: () => {
        const traceId = RequestContextService.getTraceId();

        return traceId ? { traceId } : {};
      },
      ...options,
    }).child(name ? { name } : {});
  }

  log(message: LogData, context: LogData = {}) {
    const { obj, msg } = this.resolveArgs(message, context);

    const contextName = typeof obj['context'] === 'string' ? obj['context'] : '';

    if (contextName && NEST_CONTEXT_DOWNGRADES.has(contextName)) {
      this.logger.debug(obj, msg);
    } else {
      this.logger.info(obj, msg);
    }
  }

  error(message: ErrorableLogData, context: ErrorableLogData = {}) {
    const { obj, msg } = this.resolveArgs(message, context);
    this.logger.error(obj, msg);
  }

  warn(message: LogData, context: LogData = {}) {
    const { obj, msg } = this.resolveArgs(message, context);
    this.logger.warn(obj, msg);
  }

  debug(message: LogData, context: LogData = {}) {
    const { obj, msg } = this.resolveArgs(message, context);
    this.logger.debug(obj, msg);
  }

  private resolveArgs(message: ErrorableLogData, context: ErrorableLogData = {}): PinoParams {
    const obj: Record<string, unknown> = {};

    let msg: string | undefined;

    if (context instanceof Error) {
      obj['err'] = context;
    } else if (typeof context === 'string') {
      obj['context'] = context;
    } else if (typeof context === 'object' && context !== null) {
      Object.assign(obj, context);
    }

    if (message instanceof Error) {
      obj['err'] = message;

      if (!msg) {
        msg = message.message;
      }
    } else if (typeof message === 'string') {
      msg = message;
    } else if (typeof message === 'object' && message !== null) {
      Object.assign(obj, message);
    }

    return { obj, msg };
  }
}
