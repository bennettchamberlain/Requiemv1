import knex from 'knex';

import type { Application } from './types';

export function configure(app: Application) {
  const config = app.get('postgresql');
  const db = knex(config!);

  app.set('postgresqlClient', db);
}
