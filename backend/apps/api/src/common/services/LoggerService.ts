import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';

export class LoggerService {
  private logger: PinoLogger;

  constructor(context?: string, options?: LoggerOptions) {
    this.logger = pino(options).child(context ? { context } : {});
  }

  log(message: string, context: Record<string, any> = {}) {
    this.logger.info(context, message);
  }

  error(message: string, context: Record<string, any> = {}) {
    this.logger.error(context, message);
  }

  warn(message: string, context: Record<string, any> = {}) {
    this.logger.warn(context, message);
  }

  debug(message: string, context: Record<string, any> = {}) {
    this.logger.debug(context, message);
  }
}
