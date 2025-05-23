import { app } from './app';

import { Logger } from './utils';

const port = app.get('port');
const host = app.get('host');

const logger = Logger.create('application');

process.on('unhandledRejection', (reason) => logger.error(reason));

app.listen(port).then(() => {
  logger.info(`Feathers app listening on http://${host}:${port}`);
});
