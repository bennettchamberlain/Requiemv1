// For more information about this file see https://dove.feathersjs.com/guides/cli/databases.html
import { app } from './src/app';

// Load our database connection info from the app configuration
const config = app.get('postgresql');

export default {
  // The client and connection configuration values are stored in the appropriate environment file in `config/*.json`.
  ...config,
  migrations: {
    tableName: 'migrations',
    directory: './migrations',
  },
};
