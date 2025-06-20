import { input, password as passwordInput } from '@inquirer/prompts';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import config from '@ci/configuration';
import { UserEntity } from '@ci/domains/user';

(async () => {
  const db = new DataSource({
    type: config.db.type,
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    username: config.db.username,
    password: config.db.password,
    entities: [UserEntity],
    synchronize: false,
    logging: ['error'],
  });

  await db.initialize();

  const name = await input({
    message: 'Your name:',
    validate: (value) => value.trim() !== '' || 'Name is required',
  });

  const email = await input({
    message: 'Your email:',
    validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Enter a valid email',
  });

  const password = await passwordInput({
    message: 'Your password:',
    mask: '*',
    validate: (value) => value.length >= 8 || 'Must be at least 8 characters',
  });

  await db.transaction(async (manager) => {
    await manager.save(UserEntity, {
      id: uuidv7(),
      name: name,
      email: email,
      password: await bcrypt.hash(password, config.auth.local.saltRounds),
    });
  });
})();
