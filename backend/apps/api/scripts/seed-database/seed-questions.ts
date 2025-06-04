import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { QuestionEntity } from '@ci/domains/intelligence';

import { readCsv } from './utils';

export async function seedQuestions(db: DataSource, filePath: string) {
  type CsvQuestion = {
    category: string;
    user_id: string;
    question_string: string;
    example_answer_1: string;
  };

  const records = readCsv<CsvQuestion>(filePath);

  await db.transaction(async (manager) => {
    const now = new Date();

    for (const record of records) {
      await manager.save(QuestionEntity, {
        id: uuidv7(),
        category: record.category,
        text: record.question_string,
        example_answer_1: record.example_answer_1,
        user: {
          id: record.user_id,
        },
        created_at: now,
        updated_at: now,
      });
    }
  });
}
