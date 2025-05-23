import { JWTStrategy } from '@feathersjs/authentication';
import { LocalStrategy } from '@feathersjs/authentication-local';

import {
  AuthenticationService,
  SignupService,
  UserService,
} from '../services';

import type { Application } from './types';

export function configure(app: Application) {
  const db = app.get('postgresqlClient');
  const authenticationService = new AuthenticationService(app);

  authenticationService.register('jwt', new JWTStrategy());
  authenticationService.register('local', new LocalStrategy());

  app.use('users', new UserService(db));
  app.use('signup', new SignupService(app));
  app.use('authenticate', authenticationService);

  app.service('users').hooks(UserService.hooks);
  app.service('authenticate').hooks(AuthenticationService.hooks);
  app.service('embeddings').hooks(EmbeddingsService.hooks);
}
