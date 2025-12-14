import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

interface ThingCsvRecord {
  id: string;
  type: string;
  name: string;
  description: string;
  dimensions: string;
  weight: string;
  user_id: string;
  connection_id: string;
  tags: string;
}

/**
 * Infer inventory category from thing type
 */
function inferCategory(type: string): { category: string; subcategory: string } {
  const lowerType = type.toLowerCase();

  if (
    lowerType.includes('digital') ||
    lowerType.includes('device') ||
    lowerType.includes('laptop') ||
    lowerType.includes('phone')
  ) {
    return { category: 'electronics', subcategory: lowerType };
  }

  if (lowerType.includes('safety') || lowerType.includes('gear')) {
    return { category: 'safety_equipment', subcategory: lowerType };
  }

  if (lowerType.includes('tool')) {
    return { category: 'tools', subcategory: lowerType };
  }

  if (lowerType.includes('document')) {
    return { category: 'documents', subcategory: lowerType };
  }

  if (lowerType.includes('software') || lowerType.includes('license')) {
    return { category: 'software', subcategory: lowerType };
  }

  return { category: 'other', subcategory: type };
}

/**
 * Migrate things from old schema to inventory table
 */
export async function migrateThingsToInventory(db: DataSource, filePath: string) {
  const records = readCsv<ThingCsvRecord>(filePath);
  let migratedCount = 0;
  let skippedCount = 0;

  await db.transaction(async (manager) => {
    for (const record of records) {
      // Check if inventory item already exists (by original_thing_id)
      const existing = await manager.query(
        `SELECT object_id FROM ci.inventory
         WHERE metadata->>'original_thing_id' = $1`,
        [record.id],
      );

      if (existing.length > 0) {
        skippedCount++;
        continue; // Skip if already migrated
      }

      const { category, subcategory } = inferCategory(record.type);

      // Parse tags if present
      const tags = record.tags
        ? record.tags
            .slice(1, -1)
            .split(',')
            .map((t) => t.trim().replace(/^'|'$/g, ''))
        : [];

      // Determine if digital
      const isDigital =
        record.type.toLowerCase().includes('software') ||
        record.type.toLowerCase().includes('license') ||
        record.type.toLowerCase().includes('digital');

      // Build metadata object
      const metadata: Record<string, unknown> = {
        original_thing_id: record.id,
        connection_id: record.connection_id || null,
        dimensions: record.dimensions || null,
        weight: record.weight || null,
      };

      // Insert into inventory table
      await manager.query(
        `INSERT INTO ci.inventory (
          object_id, user_id, name, description, category, subcategory,
          is_digital, metadata, tags, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          uuidv7(),
          record.user_id,
          record.name,
          record.description || null,
          category,
          subcategory,
          isDigital,
          JSON.stringify(metadata),
          JSON.stringify(tags),
        ],
      );
      migratedCount++;
    }
  });

  logger.log(`Migrated ${migratedCount} things to inventory table (${skippedCount} already existed)`);
}
