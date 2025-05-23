import configuration from '@feathersjs/configuration';

import { configure as configureDatabases } from './databases';
import { configure as configureServices } from './services';
import { configurationValidator } from './validators';

const appConfiguration = configuration(configurationValidator);

export { appConfiguration as configuration };
export { configureDatabases, configureServices };
