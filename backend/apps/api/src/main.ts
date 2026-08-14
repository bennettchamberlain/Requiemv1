// Must stay the first import — Sentry patches Node internals on init and has
// to run before any application module is loaded.
import './instrument';

import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { App } from '@ci/application';
import { LoggerService } from '@ci/common/logging';
import { processRole } from '@ci/common/roles';
import config from '@ci/configuration';

/**
 * The headless half of the appliance: the full application context — same
 * modules, same DI graph, same config — with no HTTP server. It exists so the
 * queues and crons marked `role: 'worker'` (import stages, whose parsers run
 * long synchronous stretches) execute in a process whose event loop no
 * interactive request shares. The pg-boss loops keep the process alive;
 * shutdown hooks drain them on SIGTERM exactly as the web process does.
 */
async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(App, { bufferLogs: true });

  const logger = await app.resolve(LoggerService);

  app.useLogger(logger);
  app.enableShutdownHooks();
}

async function bootstrapWeb(): Promise<void> {
  const app = await NestFactory.create(App, {
    bufferLogs: true,
    bodyParser: false,
  });

  const logger = await app.resolve(LoggerService);

  app.useLogger(logger);
  app.use(cookieParser());

  // The web app is served same-origin behind the proxy, so it needs no CORS. The
  // native Capacitor app is a different origin (its webview serves from
  // capacitor://localhost on iOS and http(s)://localhost on Android), so it must
  // be explicitly allowed. Operators can extend this with CORS_ALLOWED_ORIGINS
  // (comma-separated) for additional cross-origin clients.
  const nativeAppOrigins = [
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'https://localhost',
  ];

  app.enableCors({
    origin: [...nativeAppOrigins, ...config.cors.allowedOrigins],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-API-Key'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  const express = app.getHttpAdapter().getInstance();

  express.set('trust proxy', 1);
  express.disable('x-powered-by');

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
}

(async function () {
  if (processRole() === 'worker') {
    await bootstrapWorker();
  } else {
    await bootstrapWeb();
  }
})();
