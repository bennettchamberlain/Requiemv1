import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { ProviderEntity } from '@ci/domains/connections';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

export async function seedProviders(db: DataSource, filePath: string) {
  type CsvRecord = {
    id: string;
    name: string;
  };

  const records = readCsv<CsvRecord>(filePath);

  await db.transaction(async (manager) => {
    for (const record of records) {
      await manager.save(ProviderEntity, {
        id: record.id,
        name: record.name,
      });
    }
  });

  logger.log(`Seeded ${records.length} provider records`);
}
