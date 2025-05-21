import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { app } from '../src/app';
import { LoggingService } from '../src/logging';

declare const __dirname: string;
declare const process: any;

const logger = LoggingService.create('database-seeder');
const db = app.get('postgresqlClient');

type AnyRecord = Record<string, any>;

function readCsv(filePath: string) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: (value: any) => (value === '' ? null : value)
  });
}

function validateCsvRecords(records: AnyRecord[], requiredFields: string[], fileName: string) {
  const errors: string[] = [];
  records.forEach((record, idx) => {
    requiredFields.forEach(field => {
      if (record[field] === undefined || record[field] === null || record[field] === '') {
        errors.push(`Row ${idx + 2} in ${fileName} is missing required field: ${field}`);
      }
    });
  });
  if (errors.length > 0) {
    logger.warn(`Validation errors in ${fileName}:\n` + errors.join('\n'));
  } else {
    logger.info(`No missing required fields in ${fileName}`);
  }
}

async function seedEvents(filePath: string) {
  logger.info(`Seeding events from ${filePath}`);
  const records: AnyRecord[] = readCsv(filePath);
  validateCsvRecords(records, ['type', 'user_id', 'created'], 'js1-events.csv');
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const transformedBatch = batch.map((record: AnyRecord) => ({
      type: record.type || null,
      user_id: record.user_id || null,
      related_objects: record.related_objects ? JSON.parse(record.related_objects.replace(/'/g, '"')) : null,
      created: record.created ? new Date(record.created) : null,
      updated: record.updated ? new Date(record.updated) : null,
      connection: record.connection || null,
      provider: record.provider || null,
      data_source: record.data_source || null
    }));
    await db('Event').insert(transformedBatch).onConflict().ignore();
    logger.info(`Inserted ${batch.length} events (batch ${i/batchSize + 1})`);
  }
}

async function seedPeople(filePath: string) {
  logger.info(`Seeding people from ${filePath}`);
  const records: AnyRecord[] = readCsv(filePath);
  validateCsvRecords(records, ['first_name', 'last_name', 'type'], 'js1-people.csv');
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const transformedBatch = batch.map((record: AnyRecord) => ({
      id: record.id || null,
      first_name: record.first_name || null,
      last_name: record.last_name || null,
      middle_name: record.middle_name || null,
      gender: record.gender || null,
      address: record.address || null,
      street_address: record.street_address || null,
      street_address_2: record.street_address_2 || null,
      city: record.city || null,
      region: record.region || null,
      country: record.country || null,
      postal_code: record.postal_code || null,
      avatar_url: record.avatar_url || null,
      contact_ids: record.contact_ids ? JSON.parse(record.contact_ids.replace(/'/g, '"')) : null,
      type: record.type || null,
      created: record.created ? new Date(record.created) : null,
      external_avatar_url: record.external_avatar_url || null,
      hidden: record.hidden === 'TRUE' || record.hidden === 'true',
      tags: record.tags ? JSON.parse(record.tags.replace(/'/g, '"')) : null
    }));
    await db('Person').insert(transformedBatch).onConflict('id').ignore();
    logger.info(`Inserted ${batch.length} people (batch ${i/batchSize + 1})`);
  }
}

async function seedPlaces(filePath: string) {
  logger.info(`Seeding places from ${filePath}`);
  const records: AnyRecord[] = readCsv(filePath);
  // Implement transformation and insertion logic similar to above
}

async function seedLocations(filePath: string) {
  logger.info(`Seeding locations from ${filePath}`);
  const records: AnyRecord[] = readCsv(filePath);
  // Implement transformation and insertion logic similar to above
}

async function seedContacts(filePath: string) {
  logger.info(`Seeding contacts from ${filePath}`);
  const records: AnyRecord[] = readCsv(filePath);
  // Implement transformation and insertion logic similar to above
}

async function seedContent(filePath: string) {
  logger.info(`Seeding content from ${filePath}`);
  const records: AnyRecord[] = readCsv(filePath);
  validateCsvRecords(records, ['type', 'title'], 'jsi-content.csv');
  // Implement transformation and insertion logic similar to above
}

async function seedThings(filePath: string) {
  logger.info(`Seeding things from ${filePath}`);
  const records: AnyRecord[] = readCsv(filePath);
  validateCsvRecords(records, ['type', 'name'], 'js1-things.csv');
  // Implement transformation and insertion logic similar to above
}

async function seedUsers(filePath: string) {
  logger.info(`Seeding users from ${filePath}`);
  const records: AnyRecord[] = readCsv(filePath);
  validateCsvRecords(records, ['id', 'first_name', 'last_name', 'email', 'created'], 'user.csv');
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const transformedBatch = batch.map((record: AnyRecord) => ({
      id: record.id || null,
      first_name: record.first_name || null,
      last_name: record.last_name || null,
      email: record.email || null,
      created: record.created ? new Date(record.created) : null,
    }));
    await db('Person').insert(transformedBatch).onConflict('id').ignore();
    logger.info(`Inserted ${batch.length} users (batch ${i / batchSize + 1})`);
  }
}

async function seedDatabase() {
  try {
    logger.info('Starting database seeding process');
    const dataDir = path.resolve(__dirname, '../../../../coverage/ci-js1-data');
    await seedUsers(path.join(dataDir, 'user.csv'));
    await seedEvents(path.join(dataDir, 'js1-events.csv'));
    await seedPeople(path.join(dataDir, 'js1-people.csv'));
    await seedPlaces(path.join(dataDir, 'js1-place.csv'));
    await seedLocations(path.join(dataDir, 'js1-location.csv'));
    await seedContacts(path.join(dataDir, 'js1-contact.csv'));
    await seedContent(path.join(dataDir, 'jsi-content.csv'));
    await seedThings(path.join(dataDir, 'js1-things.csv'));
    logger.info('Database seeding completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding database:', error instanceof Error ? error.stack || error.message : error);
    console.error('Raw error:', error);
    process.exit(1);
  }
}

seedDatabase();
