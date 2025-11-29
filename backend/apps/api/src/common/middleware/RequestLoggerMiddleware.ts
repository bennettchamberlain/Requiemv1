import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

import { RequestContextService, LoggerService } from '../services';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new LoggerService('request');

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    let fired = false;

    const handleDone = () => {
      if (fired) {
        return false;
      }

      fired = true;

      const duration = process.hrtime.bigint() - start;
      const userId = RequestContextService.getUserId();

      this.logger.log('Request processed', {
        ...(userId && { userId }),
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: Number(duration) / 1_000_000,
        termination: res.writableEnded ? 'finished' : 'closed',
      });
    };

    res.on('finish', handleDone);
    res.on('close', handleDone);

    next();
  }
}
