import { AuthenticationService, JWTStrategy } from '@feathersjs/authentication';
import { LocalStrategy } from '@feathersjs/authentication-local';

import type { Application } from '../configuration/types';
import { hooks as authHooks } from './authentication-service';
import { SignupService } from './signup-service';
import { UserService, hooks as userHooks } from './user-service';

export function services(app: Application) {
  const db = app.get('postgresqlClient');
  const authenticationService = new AuthenticationService(app);

  authenticationService.register('jwt', new JWTStrategy());
  authenticationService.register('local', new LocalStrategy());

  app.use('users', new UserService(db));
  app.use('signup', new SignupService(app));
  app.use('authenticate', authenticationService);

  app.service('users').hooks(userHooks);
  app.service('authenticate').hooks(authHooks);
}

export { UserService };
