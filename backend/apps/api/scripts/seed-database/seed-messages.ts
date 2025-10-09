import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { MessageEntity } from '@ci/domains/conversations';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

export async function seedMessages(db: DataSource, filePath: string) {
  type CsvRecord = {
    id: string;
    model: string;
    text: string;
    mimetype: string;
    canceled: boolean;
    user_id: string;
    thread_id: string;
    role: string;
  };

  const records = readCsv<CsvRecord>(filePath);

  await db.transaction(async (manager) => {
    for (const record of records) {
      const message = manager.create(MessageEntity, {
        id: record.id,
        model: record.model ?? null,
        role: record.role,
        content: record.text ?? '',
        mimetype: record.mimetype ?? null,
        canceled: Boolean(record.canceled),
        user: record.user_id
          ? {
              id: record.user_id,
            }
          : undefined,
        thread: record.thread_id
          ? {
              id: record.thread_id,
            }
          : undefined,
      });

      await manager.save(MessageEntity, message);
    }
  });

  logger.log(`Seeded ${records.length} message records`);
}
