import type { LoggerService as NestLoggerService } from '@nestjs/common';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';
import pino from 'pino';

import config from '@ci/configuration';

import { RequestContextService } from './RequestContextService';

type LogData = string | Record<string, unknown>;

interface ResolvedData {
  traceId?: string;
  context?: string;
  message?: string;
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
      ...options,
    } satisfies LoggerOptions).child(name ? { name } : {});
  }

  log(message: LogData, context: LogData = {}) {
    const { message: msg, ...rest } = this.normalizeLogData(message, context);

    if (rest.context != null && NEST_CONTEXT_DOWNGRADES.has(rest.context)) {
      this.logger.debug(rest, msg);
    } else {
      this.logger.info(rest, msg);
    }
  }

  error(message: LogData | Error, context: LogData | Error = {}) {
    if (message instanceof Error) {
      const resolvedContext = this.normalizeLogContext(context);
      const childLogger = this.logger.child(resolvedContext);

      childLogger.error(message);
    } else {
      const { message: msg, ...rest } = this.normalizeLogData(message, context);

      this.logger.error(rest, msg);
    }
  }

  warn(message: LogData, context: LogData = {}) {
    const { message: msg, ...rest } = this.normalizeLogData(message, context);

    this.logger.warn(rest, msg);
  }

  debug(message: LogData, context: LogData = {}) {
    const { message: msg, ...rest } = this.normalizeLogData(message, context);

    this.logger.debug(rest, msg);
  }

  private normalizeLogContext(context: LogData | Error = {}) {
    if (context instanceof Error) {
      return {
        traceId: RequestContextService.getTraceId(),
        err: context,
      };
    }

    const contextObj = typeof context === 'string' ? { context } : context;

    return {
      traceId: RequestContextService.getTraceId(),
      ...contextObj,
    };
  }

  private normalizeLogData(message: LogData = {}, context: LogData | Error = {}): ResolvedData {
    const resolvedMessage = typeof message === 'string' ? { message } : message;
    const resolvedContext = this.normalizeLogContext(context);

    return {
      ...(resolvedContext as object),
      ...(resolvedMessage as object),
    };
  }
}
