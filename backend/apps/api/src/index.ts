import { app } from './app';

import { LoggingService } from './logging';

const port = app.get('port');
const host = app.get('host');

const logger = LoggingService.create('application');

process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection %O', reason));

app.listen(port).then(() => {
  logger.info(`Feathers app listening on http://${host}:${port}`);
});
