import path from 'path';

import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import config from '@ci/configuration';
import { MessageEntity, ThreadEntity } from '@ci/domains/conversations';
import { FileEntity } from '@ci/domains/files';
import { ActionEntity, AnswerEntity, QuestionEntity } from '@ci/domains/intelligence';
import { TagEntity } from '@ci/domains/search';
import { UserEntity } from '@ci/domains/user';

import { seedActions } from './seed-actions';
import { seedAnswers } from './seed-answers';
import { seedMessages } from './seed-messages';
import { seedThreads } from './seed-threads';
import { seedUsers } from './seed-users';

const logger = new Logger(path.basename(__filename));

(async function () {
  const dataDir = path.resolve(__dirname);

  const db = new DataSource({
    type: config.db.type,
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    username: config.db.username,
    password: config.db.password,
    entities: [
      // Conversation
      MessageEntity,
      ThreadEntity,
      // Files
      FileEntity,
      // Intelligence
      ActionEntity,
      AnswerEntity,
      QuestionEntity,
      // Search,
      TagEntity,
      // Users
      UserEntity,
    ],
    synchronize: false,
    logging: ['error'],
  });

  let error: Error | null;

  try {
    await db.initialize();

    await seedUsers(db, path.resolve(dataDir, './js1-data/js1-users.csv'));
    await seedAnswers(db, path.resolve(dataDir, './js1-data/js1-answers.csv'));
    await seedThreads(db, path.resolve(dataDir, './js1-data/js1-threads.csv'));
    await seedActions(db, path.resolve(dataDir, './js1-data/js1-actions.csv'));
    await seedMessages(db, path.resolve(dataDir, './js1-data/js1-messages.csv'));

    process.exit(0);
  } catch (err) {
    error = err as Error;
  }

  if (error) {
    logger.error(error);
  }

  if (db.isInitialized) {
    await db.destroy();
  }

  process.exit(error == null ? 0 : 1);
})();
