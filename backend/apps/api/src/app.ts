// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html
import { feathers } from '@feathersjs/feathers';

import { koa, rest, bodyParser, errorHandler, parseAuthentication, cors, serveStatic } from '@feathersjs/koa';

import { postgresql } from './configuration/postgresql';
import type { Application } from './configuration/types';
import { appConfiguration } from './configuration';
import { logError } from './hooks/log-error';
import { logRequest } from './hooks/log-request';
import { services } from './services/index';

const app: Application = koa(feathers());

// Load our app configuration (see config/ folder)
app.configure(appConfiguration);

// Set up Koa middleware
app.use(cors());
app.use(errorHandler());
app.use(parseAuthentication());
app.use(bodyParser());

// Configure services and transports
app.configure(rest());

app.configure(postgresql);
app.configure(services);

// Register hooks that run on all service methods
app.hooks({
  around: {
    all: [logRequest, logError],
  },
  before: {},
  after: {},
  error: {},
});

// Register application setup and teardown hooks here
app.hooks({
  setup: [],
  teardown: [],
});

export { app };
