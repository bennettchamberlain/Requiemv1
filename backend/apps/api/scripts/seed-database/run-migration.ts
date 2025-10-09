import path from 'path';

import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import config from '@ci/configuration';

import { migrateEvents } from './migrate-events';
import { migrateLocationsToPosition } from './migrate-locations-to-position';
import { migratePlacesToEntities } from './migrate-places-to-entities';
import { migrateThingsToInventory } from './migrate-things-to-inventory';

const logger = new Logger(path.basename(__filename));

/**
 * Main migration script for old schema to new schema
 *
 * Migration order:
 * 1. Places → Entities (Location nodes in graph)
 * 2. Locations → Position (with spatial matching to places)
 * 3. Things → Inventory (with category inference)
 * 4. Events → Events (with enhanced fields)
 */
(async function () {
  const dataDir = path.resolve(__dirname, './js1-data');

  const db = new DataSource({
    type: config.db.type,
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    username: config.db.username,
    password: config.db.password,
    // No entities needed - using raw queries
    synchronize: false,
    logging: ['error', 'warn'],
  });

  let error: Error | null = null;

  try {
    await db.initialize();
    logger.log('Database connection established');

    // Step 1: Migrate places to entities
    logger.log('Starting migration: Places → Entities');
    await migratePlacesToEntities(db, path.resolve(dataDir, 'js1-places.csv'));

    // Step 2: Migrate locations to position
    logger.log('Starting migration: Locations → Position');
    await migrateLocationsToPosition(db, path.resolve(dataDir, 'js1-locations.csv'));

    // Step 3: Migrate things to inventory
    logger.log('Starting migration: Things → Inventory');
    await migrateThingsToInventory(db, path.resolve(dataDir, 'js1-things.csv'));

    // Step 4: Migrate events to events
    logger.log('Starting migration: Events → Events (new schema)');
    await migrateEvents(db, path.resolve(dataDir, 'js1-events.csv'));

    logger.log('✅ All migrations completed successfully');
    process.exit(0);
  } catch (err) {
    error = err as Error;
  }

  if (error) {
    logger.error('❌ Migration failed:', error);
  }

  if (db.isInitialized) {
    await db.destroy();
  }

  process.exit(error == null ? 0 : 1);
})();
