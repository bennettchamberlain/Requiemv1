import { NestFactory } from '@nestjs/core';
import { App } from './app';
import config from './config';

async function bootstrap() {
  const app = await NestFactory.create(App);

  app.getHttpAdapter().getInstance().disable('x-powered-by');

  await app.listen(config.port, config.host);
}

bootstrap();
