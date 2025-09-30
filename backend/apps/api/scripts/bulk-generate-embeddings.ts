import path from 'path';

import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import config from '@ci/configuration';
import { ConnectionEntity, ProviderEntity } from '@ci/domains/connections';
import { AnswerEntity, QuestionEntity } from '@ci/domains/intelligence';
import { ContentEntity, EventEntity } from '@ci/domains/memory';
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
      ContentEntity,
      EventEntity,
      ProviderEntity,
      QuestionEntity,
      TagEntity,
      UserEntity,
    ],
    synchronize: false,
    logging: ['error', 'schema'],
  });

  let error: Error | null;

  try {
    await db.initialize();

    // Create embedding service with DataSource
    const embeddingService = new EmbeddingService(db);

    // Index questions - embeddings written directly to questions.question_embedding
    await db.transaction(async (manager) => {
      const questions = await manager.find(QuestionEntity);

      logger.log(`Indexing ${questions.length} question records`);

      for (const [index, question] of questions.entries()) {
        logger.log(`Generating vector embeddings for question, ${index + 1} / ${questions.length}`);

        // Add 'id' property for the embedding service
        const indexableEntity = Object.assign(question, { id: question.question_id });
        await embeddingService.indexEntity(indexableEntity, 'question_text');
      }
    });

    // Index answers - embeddings written directly to answers.answer_embedding
    await db.transaction(async (manager) => {
      const answers = await manager.find(AnswerEntity, {
        relations: ['user', 'question'],
      });

      logger.log(`Indexing ${answers.length} answer records`);

      for (const [index, answer] of answers.entries()) {
        logger.log(`Generating vector embeddings for answer, ${index + 1} / ${answers.length}`);

        // Add 'id' property for the embedding service
        const indexableEntity = Object.assign(answer, { id: answer.answer_id });
        await embeddingService.indexEntity(indexableEntity, 'answer_text');
      }
    });

    // Note: Content table doesn't have embedding column yet - skipping for now
    // Uncomment when content table has content_embedding column added
    /*
    await db.transaction(async (manager) => {
      const content = await manager.find(ContentEntity, {
        relations: ['user'],
      });

      logger.log(`Indexing ${content.length} content records`);

      for (const [index, entity] of content.entries()) {
        logger.log(`Generating vector embeddings for content, ${index + 1} / ${content.length}`);

        if (entity.text == null) {
          continue;
        }

        await embeddingService.indexEntity(entity, 'text');
      }
    });
    */

    logger.log('✅ All embeddings generated and stored successfully!');
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
