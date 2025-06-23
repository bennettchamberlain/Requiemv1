import path from 'path';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { ProviderEntity } from '@ci/domains/providers';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

export async function seedProviders(db: DataSource, filePath: string) {
  type CsvRecord = {
    id: string;
    name: string;
    created_at: Date;
    updated_at: Date;
  };

  const records = readCsv<CsvRecord>(filePath);

  await db.transaction(async (manager) => {
    for (const record of records) {
      await manager.save(ProviderEntity, {
        id: record.id,
        name: record.name,
        created_at: record.created_at,
        updated_at: record.updated_at,
      });
    }
  });

  logger.log(`Seeded ${records.length} provider records`);
}
