import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

export async function seedAnswers(db: DataSource, filePath: string) {
  type CsvRecord = {
    id: string;
    user_id: string;
    question_id: string;
    give_answer_1: string;
  };

  const records = readCsv<CsvRecord>(filePath);

  await db.transaction(async (manager) => {
    for (const record of records) {
      // Map old CSV structure to new comprehensive answers table
      await manager.query(
        `
        INSERT INTO answers (
          answer_id,
          question_id,
          user_id,
          answer_text,
          answer_source,
          answer_method,
          answered_at,
          is_sensitive,
          sharing_level
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
        ON CONFLICT (answer_id) DO NOTHING
        `,
        [
          record.id, // answer_id (UUID from CSV)
          record.question_id, // question_id (FK to questions table)
          record.user_id, // user_id (FK to users table)
          record.give_answer_1, // answer_text (the actual answer content)
          'imported', // answer_source (these are imported seed data)
          'survey', // answer_method (original collection method)
          false, // is_sensitive (default to false for seed data)
          'private', // sharing_level (default to private)
        ],
      );
    }
  });

  logger.log(`Seeded ${records.length} answer records`);
}
