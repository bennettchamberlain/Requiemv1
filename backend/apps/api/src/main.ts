// Must stay the first import — Sentry patches Node internals on init and has
// to run before any application module is loaded.
import './instrument';

import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { App } from '@ci/application';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

(async function () {
  const app = await NestFactory.create(App, {
    bufferLogs: true,
    bodyParser: false,
  });

  const logger = await app.resolve(LoggerService);

  app.useLogger(logger);
  app.use(cookieParser());

  const express = app.getHttpAdapter().getInstance();

  express.set('trust proxy', 1);
  express.disable('x-powered-by');

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
})();
