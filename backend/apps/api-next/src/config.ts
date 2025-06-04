import config from 'config';

import { z } from 'zod';

export const ConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  auth: z.object({
    local: z.object({
      saltRounds: z.number(),
    }),
    jwt: z.object({
      secret: z.string(),
    }),
  }),
  db: z.object({
    type: z.literal('postgres'), // restrict to 'postgres' (or z.string() for other DBs)
    url: z.string(),
    logging: z.union([z.literal(false), z.array(z.enum(['query', 'error']))]),
  }),
});

export default ConfigSchema.parse(config);
