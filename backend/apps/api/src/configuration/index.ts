import configuration from '@feathersjs/configuration';

import { configurationValidator } from './validators';

export const appConfiguration = configuration(configurationValidator);
