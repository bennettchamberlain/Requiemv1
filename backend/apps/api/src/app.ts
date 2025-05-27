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

// Add signup route to authentication
app.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await app.service('users').find({
      query: { email }
    });

    if (existingUser.total > 0) {
      return res.status(409).json({ message: 'User with this email already exists' });
    }

    // Create new user
    const newUser = await app.service('users').create({
      email,
      password,
      name: name || email.split('@')[0]
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = newUser;
    
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Internal server error during signup' });
  }
});

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
