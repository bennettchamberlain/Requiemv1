import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { ActionEntity } from '@ci/domains/intelligence';

import { parseTags, readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

export async function seedActions(db: DataSource, filePath: string) {
  type CsvRecord = {
    id: string;
    title: string;
    text: string;
    image_url: string;
    thread_id: string;
    user_id: string;
    tags: string;
  };

  const records = readCsv<CsvRecord>(filePath);

  await db.transaction(async (manager) => {
    for (const record of records) {
      await manager.save(ActionEntity, {
        id: record.id,
        title: record.title,
        text: record.text,
        imageUrl: record.image_url,
        thread: {
          id: record.thread_id,
        },
        user: {
          id: record.user_id,
        },
      });

      const tagNames = parseTags(record.tags);

      if (tagNames.length > 0) {
        for (const tagName of tagNames) {
          const cleanTag = tagName.toLowerCase();

          const existingTags = await manager.query(
            `SELECT id FROM ci_search.tags WHERE label = $1 AND user_id = $2`,
            [cleanTag, record.user_id],
          );

          let tagId: string;

          if (existingTags.length > 0) {
            tagId = existingTags[0].id;
          } else {
            tagId = uuidv7();

            await manager.query(`INSERT INTO ci_search.tags (id, label, user_id) VALUES ($1, $2, $3)`, [
              tagId,
              cleanTag,
              record.user_id,
            ]);
          }

          await manager.query(
            `INSERT INTO ci_search.entity_tag (entity_type, entity_id, tag_id) VALUES ($1, $2, $3)`,
            ['action', record.id, tagId],
          );
        }
      }
    }
  });

  logger.log(`Seeded ${records.length} action records`);
}
