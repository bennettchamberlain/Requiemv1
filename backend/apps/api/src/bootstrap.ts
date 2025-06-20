import dotenv from 'dotenv';
import path from 'node:path';

const envPath = process.env.DOTENV_CONFIG_PATH || '.env';

dotenv.config({ path: path.resolve(process.cwd(), envPath) });
