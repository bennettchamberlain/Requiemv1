import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

export async function seedQuestions(db: DataSource, filePath: string) {
  type CsvQuestion = {
    id: string;
    category: string;
    subcategory: string;
    user_id: string;
    question_string: string;
    example_answer_1: string;
  };

  const records = readCsv<CsvQuestion>(filePath);

  await db.transaction(async (manager) => {
    for (const record of records) {
      // Map old CSV structure to new comprehensive questions table
      const contextTags: string[] = [];

      // Add category and subcategory to context_tags array
      if (record.category) {
        contextTags.push(record.category);
      }

      if (record.subcategory) {
        contextTags.push(record.subcategory);
      }

      await manager.query(
        `
        INSERT INTO ci.questions (
          question_id,
          question_text,
          question_category,
          context_tags,
          question_type,
          is_seed_question,
          created_by_llm,
          frequency_recommendation,
          is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (question_id) DO NOTHING
        `,
        [
          record.id, // question_id (UUID from CSV)
          record.question_string, // question_text
          record.category || null, // question_category
          contextTags, // context_tags (array with category and subcategory)
          'open_ended', // question_type (all CSV questions are open-ended)
          true, // is_seed_question (these are our initial questions)
          false, // created_by_llm (these are human-curated)
          'one_time', // frequency_recommendation (can be updated later)
          true, // is_active
        ],
      );
    }
  });

  logger.log(`Seeded ${records.length} question records`);
}
