import bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';

import config from '@ci/config';
import { UserEntity } from '@ci/domains/user';

import { readCsv } from './utils';

export async function seedUsers(db: DataSource, filePath: string) {
  type CsvUser = {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    created: Date;
  };

  const records = readCsv<CsvUser>(filePath);

  await db.transaction(async (manager) => {
    for (const record of records) {
      await manager.save(UserEntity, {
        id: record.id,
        name: `${record.first_name} ${record.last_name}`,
        email: record.email,
        password: await bcrypt.hash('companion', config.auth.local.saltRounds),
        created_at: record.created,
        updated_at: record.created,
      });
    }
  });
}
