import { feathers } from '@feathersjs/feathers';
import { koa, rest, bodyParser, errorHandler, parseAuthentication, cors } from '@feathersjs/koa';

import type { Application } from './configuration/types';
import { configureDatabases, configureServices, configuration } from './configuration';
import { logError, logRequest } from './hooks';

const app: Application = koa(feathers());

// Load our app configuration (see config/ folder)
app.configure(configuration);

// Set up Koa middleware
app.use(cors());
app.use(errorHandler());
app.use(parseAuthentication());
app.use(bodyParser());

// Configure services and transports
app.configure(rest());

app.configure(configureDatabases);
app.configure(configureServices);

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
