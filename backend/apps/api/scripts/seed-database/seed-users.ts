import path from 'path';

import { Logger } from '@nestjs/common';
import bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';

import config from '@ci/configuration';
import { UserEntity } from '@ci/domains/user';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

export async function seedUsers(db: DataSource, filePath: string) {
  type CsvRecord = {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    created_at: Date;
    updated_at: Date;
  };

  const records = readCsv<CsvRecord>(filePath);

  if (process.env.AUTH_DEFAULT_USER_PASSWORD == null) {
    throw new Error('Default user password not specified');
  }

  const hashedPassword = await bcrypt.hash(
    process.env.AUTH_DEFAULT_USER_PASSWORD!,
    config.auth.local.saltRounds,
  );

  await db.transaction(async (manager) => {
    for (const record of records) {
      // Check if user already exists
      const existingUser = await manager.findOne(UserEntity, {
        where: { id: record.id },
      });

      if (existingUser) {
        logger.log(`User ${record.email} already exists, skipping...`);
        continue;
      }

      // Use raw SQL to insert with enhanced fields since UserEntity might not have all columns yet
      await manager.query(
        `
        INSERT INTO ci.users (
          id, name, email, password, created_at, updated_at,
          username, password_hash, role, is_active, is_verified,
          timezone, language, login_count, failed_login_attempts,
          settings, api_keys, permissions, display_preferences, onboarded
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19, $20
        )
      `,
        [
          record.id,
          `${record.first_name} ${record.last_name}`,
          record.email,
          hashedPassword,
          record.created_at,
          record.updated_at,
          record.email.split('@')[0], // username from email prefix
          hashedPassword, // password_hash (duplicate for compatibility)
          'user', // role
          true, // is_active
          true, // is_verified
          'UTC', // timezone
          'en', // language
          0, // login_count
          0, // failed_login_attempts
          '{}', // settings (empty JSON)
          '{}', // api_keys (empty JSON)
          '{}', // permissions (empty JSON)
          '{}', // display_preferences (empty JSON)
          true, // Seeded users should be automatically onboarded
        ],
      );

      logger.log(`Seeded user: ${record.email}`);
    }
  });

  logger.log(`Seeded ${records.length} user records`);
}
