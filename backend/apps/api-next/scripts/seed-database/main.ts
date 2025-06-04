import path from 'path';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import config from '@ci/config';
import { AnswerEntity, QuestionEntity } from '@ci/domains/intelligence';
import { UserEntity } from '@ci/domains/user';

import { seedUsers } from './seed-users';
import { seedQuestions } from './seed-questions';

const logger = new Logger(path.basename(__filename));

(async function () {
  const dataDir = path.resolve(__dirname, '../../../../../coverage/ci-js1-data');

  const db = new DataSource({
    type: config.db.type,
    url: config.db.url,
    entities: [AnswerEntity, QuestionEntity, UserEntity],
    synchronize: false,
    logging: ['query', 'error'],
  });

  let error: Error | null;

  try {
    await db.initialize();

    await seedUsers(db, path.join(dataDir, 'js1-user.csv'));
    await seedQuestions(db, path.join(dataDir, 'questions.csv'));

    process.exit(0);
  } catch (err: unknown) {
    error = err as Error;
  } finally {
    await db.destroy();
  }

  if (error) {
    logger.error(error);
  }

  process.exit(error == null ? 0 : 1);
})();
