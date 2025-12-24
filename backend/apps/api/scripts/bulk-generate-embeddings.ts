import path from 'path';

import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import config from '@ci/configuration';
import { ConnectionEntity, ProviderEntity } from '@ci/domains/connections';
import { AnswerEntity, QuestionEntity } from '@ci/domains/intelligence';
import { EventEntity } from '@ci/domains/memory';
import { EmbeddingService, TagEntity } from '@ci/domains/search';
import { UserEntity } from '@ci/domains/user';

const logger = new Logger(path.basename(__filename));

(async function () {
  const db = new DataSource({
    type: config.db.type,
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    username: config.db.username,
    password: config.db.password,
    entities: [
      AnswerEntity,
      ConnectionEntity,
      EventEntity,
      ProviderEntity,
      QuestionEntity,
      TagEntity,
      UserEntity,
    ],
    synchronize: false,
    logging: ['error', 'schema'],
  });

  let error: Error | null = null;

  try {
    await db.initialize();

    const embeddingService = new EmbeddingService(db);

    logger.log('Starting bulk embedding generation...');

    const questionsCount = await embeddingService.embedAllQuestions();
    logger.log(`✅ Generated embeddings for ${questionsCount} questions`);

    const answersCount = await embeddingService.embedAllAnswers();
    logger.log(`✅ Generated embeddings for ${answersCount} answers`);

    const entitiesCount = await embeddingService.embedAllEntities();
    logger.log(`✅ Generated embeddings for ${entitiesCount} entities`);

    const inventoryCount = await embeddingService.embedAllInventoryItems();
    logger.log(`✅ Generated embeddings for ${inventoryCount} inventory items`);

    const factsCount = await embeddingService.embedAllFacts();
    logger.log(`✅ Generated embeddings for ${factsCount} facts`);

    const documentsCount = await embeddingService.embedAllDocuments();
    logger.log(`✅ Generated embeddings for ${documentsCount} documents`);

    const chunksCount = await embeddingService.embedAllDocumentChunks();
    logger.log(`✅ Generated embeddings for ${chunksCount} document chunks`);

    const messagesCount = await embeddingService.embedAllMessages();
    logger.log(`✅ Generated embeddings for ${messagesCount} messages`);

    const totalCount =
      questionsCount +
      answersCount +
      entitiesCount +
      inventoryCount +
      factsCount +
      documentsCount +
      chunksCount +
      messagesCount;

    logger.log(`\n🎉 All embeddings generated successfully! Total: ${totalCount} items`);
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
