import { app } from './app';
import { configureJobQueue } from './configuration';

import { Logger } from './utils';

const port = app.get('port');
const host = app.get('host');

const logger = Logger.create('application');

process.on('unhandledRejection', (reason) => logger.error(reason));

app.listen(port).then(async () => {
  logger.info(`Feathers app listening on http://${host}:${port}`);

  // Start job queue service
  try {
    await configureJobQueue(app);
    logger.info('Job queue service started successfully');
  } catch (error) {
    logger.error('Failed to start job queue service:', error);
    process.exit(1);
  }
});
