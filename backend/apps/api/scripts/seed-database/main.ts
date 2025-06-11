import path from 'path';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import config from '@ci/config';
import { AnswerEntity, QuestionEntity } from '@ci/domains/intelligence';
import {
  ContactEntity,
  ContentEntity,
  EventEntity,
  LocationEntity,
  PersonEntity,
  PlaceEntity,
  TagEntity,
  ThingEntity,
} from '@ci/domains/memory';
import { UserEntity } from '@ci/domains/user';

import { seedAnswers } from './seed-answers';
import { seedContacts } from './seed-contacts';
import { seedContent } from './seed-content';
import { seedEvents } from './seed-events';
import { seedLocations } from './seed-locations';
import { seedPeople } from './seed-people';
import { seedPlaces } from './seed-places';
import { seedQuestions } from './seed-questions';
import { seedThings } from './seed-things';
import { seedUsers } from './seed-users';

const logger = new Logger(path.basename(__filename));

(async function () {
  const dataDir = path.resolve(__dirname);

  const db = new DataSource({
    type: config.db.type,
    url: config.db.url,
    entities: [
      // Memory
      ContactEntity,
      ContentEntity,
      EventEntity,
      LocationEntity,
      PersonEntity,
      PlaceEntity,
      TagEntity,
      ThingEntity,
      // Intelligence
      AnswerEntity,
      QuestionEntity,
      // Users
      UserEntity,
    ],
    synchronize: false,
    logging: ['error'],
  });

  let error: Error | null;

  try {
    await db.initialize();

    // Intelligence Data
    await seedQuestions(db, path.resolve(dataDir, './intelligence-data/questions.csv'));

    // John Smith
    await seedUsers(db, path.resolve(dataDir, './js1-data/js1-users.csv'));
    await seedEvents(db, path.resolve(dataDir, './js1-data/js1-events.csv'));
    await seedPeople(db, path.resolve(dataDir, './js1-data/js1-people.csv'));
    await seedContacts(db, path.resolve(dataDir, './js1-data/js1-contacts.csv'));
    await seedContent(db, path.resolve(dataDir, './js1-data/js1-content.csv'));
    await seedThings(db, path.resolve(dataDir, './js1-data/js1-things.csv'));
    await seedPlaces(db, path.resolve(dataDir, './js1-data/js1-places.csv'));
    await seedLocations(db, path.resolve(dataDir, './js1-data/js1-locations.csv'));
    await seedAnswers(db, path.resolve(dataDir, './js1-data/js1-answers.csv'));

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
