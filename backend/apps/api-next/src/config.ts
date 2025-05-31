import config from 'config';

import { z } from 'zod';

export const ConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  auth: z.object({
    jwt: z.object({
      secret: z.string(),
    }),
  }),
  db: z.object({
    type: z.literal('postgres'), // restrict to 'postgres' (or z.string() for other DBs)
    url: z.string(),
  }),
});

export default ConfigSchema.parse(config);
