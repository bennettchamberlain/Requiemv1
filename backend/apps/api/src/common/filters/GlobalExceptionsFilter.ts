import { Catch, ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

import { LoggerService } from '../services/LoggerService';

@Catch()
export class GlobalExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new LoggerService('exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    this.logger.error(exception instanceof Error ? exception : new Error(String(exception)));

    super.catch(exception, host);
  }
}
