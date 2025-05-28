import { hooks as schemaHooks } from '@feathersjs/schema';

import type { Application } from './types';
import { UserService } from '../services/user-service';
import { SignupService } from '../services/signup-service';
import { AuthenticationService } from '../services/authentication-service';
import { AnswersService } from '../services/answers-service';
import { QuestionsService } from '../services/questions-service';
import { EmbeddingsService, InternalEmbeddingsService } from '../services/embeddings-service';
import { SearchService } from '../services/search-service';

export function configureServices(app: Application) {
  const db = app.get('postgresqlClient');

  app.use('users', new UserService(db), {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: [],
  });

  app.use('signup', new SignupService(app), {
    methods: ['create'],
    events: [],
  });

  app.use('authentication', new AuthenticationService(app), {
    methods: ['create', 'remove'],
    events: [],
  });

  app.use('answers', new AnswersService(db), {
    methods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
    events: [],
  });

  app.use('questions', new QuestionsService(db), {
    methods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
    events: [],
  });

  app.use('embeddings', new EmbeddingsService(app), {
    methods: ['create'],
    events: [],
  });

  app.use('internalEmbeddings', new InternalEmbeddingsService(db), {
    methods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
    events: [],
  });

  app.use('search', new SearchService(app), {
    methods: ['find'],
    events: [],
  });

  // All services will be registered here
  app.service('users').hooks(UserService.hooks);
  app.service('signup').hooks(SignupService.hooks);
  app.service('authentication').hooks(AuthenticationService.hooks);
  app.service('answers').hooks(AnswersService.hooks);
  app.service('questions').hooks(QuestionsService.hooks);
  app.service('embeddings').hooks(EmbeddingsService.hooks);
  app.service('internalEmbeddings').hooks(InternalEmbeddingsService.hooks);
  app.service('search').hooks(SearchService.hooks);

  // Register schema hooks for all services
  app.hooks({
    setup: [],
    teardown: [],
    around: {
      all: [schemaHooks.resolveExternal, schemaHooks.resolveResult],
    },
  });
}
