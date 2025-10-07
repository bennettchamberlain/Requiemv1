import * as crypto from 'node:crypto';

import { input } from '@inquirer/prompts';
import { DataSource } from 'typeorm';

import config from '@ci/configuration';
import { SignupCodeEntity } from '@ci/domains/user';

(async () => {
  const db = new DataSource({
    type: config.db.type,
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    username: config.db.username,
    password: config.db.password,
    entities: [SignupCodeEntity],
    synchronize: false,
    logging: ['error'],
  });

  await db.initialize();

  const numCodes = await input({
    message: 'Number of signup codes to generate:',
    validate: (value) =>
      (value.trim() !== '' && parseInt(value) > 0) ||
      'Number of codes is required and must be an integer > 0',
  });

  let exitCode = 0;
  const codes: string[] = [];

  try {
    for (let i = 0; i < parseInt(numCodes); i++) {
      await db.transaction(async (manager) => {
        const code = crypto.randomBytes(6).toString('hex');

        await manager.save(SignupCodeEntity, {
          signup_code: code,
        });

        codes.push(code);
      });
    }

    console.log(`\nSuccessfully created codes:\n${codes.join('\n')}\n`);
  } catch (err) {
    console.error('\nFailed to create some codes:', (err as Error).message);
    if (codes.length > 0) {
      console.log('\nBut did create these codes', codes);
    }

    exitCode = 1;
  }

  await db.destroy();

  process.exit(exitCode);
})();
