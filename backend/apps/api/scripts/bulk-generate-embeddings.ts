import path from 'path';

import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import config from '@ci/configuration';
import { ConnectionEntity, ProviderEntity } from '@ci/domains/connections';
import { AnswerEntity, QuestionEntity } from '@ci/domains/intelligence';
import { ContentEntity, EventEntity } from '@ci/domains/memory';
import { EmbeddingEntity, EmbeddingService, TagEntity } from '@ci/domains/search';
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
      EmbeddingEntity,
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

    const embeddingRepo = db.getRepository(EmbeddingEntity);
    const embeddingService = new EmbeddingService(embeddingRepo);

    // Index questions and write embeddings back to the questions table
    await db.transaction(async (manager) => {
      const questions = await manager.find(QuestionEntity);

      logger.log(`Indexing ${questions.length} question records`);

      for (const [index, question] of questions.entries()) {
        logger.log(`Generating vector embeddings for question, ${index + 1} / ${questions.length}`);

        // Generate embedding via the embedding service (stores in embeddings table)
        const indexableEntity = Object.assign(question, { id: question.question_id });
        const embeddingVector = await embeddingService.indexEntity(indexableEntity, 'question_text');

        // Update the question table with the embedding vector
        await manager.query(`UPDATE questions SET question_embedding = $1 WHERE question_id = $2`, [
          `[${embeddingVector.join(',')}]`,
          question.question_id,
        ]);
      }
    });

    // Index answers and write embeddings back to the answers table
    await db.transaction(async (manager) => {
      const answers = await manager.find(AnswerEntity, {
        relations: ['user', 'question'],
      });

      logger.log(`Indexing ${answers.length} answer records`);

      for (const [index, answer] of answers.entries()) {
        logger.log(`Generating vector embeddings for answer, ${index + 1} / ${answers.length}`);

        // Generate embedding via the embedding service (stores in embeddings table)
        const indexableEntity = Object.assign(answer, { id: answer.answer_id });
        const embeddingVector = await embeddingService.indexEntity(indexableEntity, 'answer_text');

        // Update the answers table with the embedding vector
        await manager.query(`UPDATE answers SET answer_embedding = $1 WHERE answer_id = $2`, [
          `[${embeddingVector.join(',')}]`,
          answer.answer_id,
        ]);
      }
    });

    // Index content (no direct embedding column to update, only uses embeddings table)
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
