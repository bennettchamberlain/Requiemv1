import { NestFactory } from '@nestjs/core';

import { App } from '@ci/application';
import config from '@ci/configuration';

(async function () {
  const app = await NestFactory.create(App);
  const express = app.getHttpAdapter().getInstance();

  express.set('trust proxy', true);
  express.disable('x-powered-by');

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
})();
