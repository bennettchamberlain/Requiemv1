// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../configuration/types';
import { UserService } from './user';

export function services(app: Application) {
  const db = app.get('postgresqlClient');

  app.use('user', new UserService(db));
}
