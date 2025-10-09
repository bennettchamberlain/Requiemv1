import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));
const JOHN_SMITH_EMAIL = 'jsmith@example.com';

interface PlaceCsvRecord {
  id: string;
  type: string;
  name: string;
  geo_format: string;
  geolocation: string;
  location_boundary: string;
  estimated: boolean;
  tracked: boolean;
  uploaded: boolean;
  parent_id: string;
  user_id: string;
  connection_id: string;
  provider_id: string;
  tags: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Migrate places from old schema to entities table as Location nodes
 * Creates GeoJSON polygon boundaries for spatial queries
 */
export async function migratePlacesToEntities(db: DataSource, filePath: string) {
  const records = readCsv<PlaceCsvRecord>(filePath);
  let migratedCount = 0;
  let skippedCount = 0;

  await db.transaction(async (manager) => {
    const ownerUserRows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [JOHN_SMITH_EMAIL],
    );

    if (!ownerUserRows?.[0]?.id) {
      throw new Error(
        `Could not find John Smith user (email: ${JOHN_SMITH_EMAIL}) while migrating places. ` +
          'Seed the users table before running this migration.',
      );
    }

    const defaultOwnerUserId = ownerUserRows[0].id;

    for (const record of records) {
      const geolocation = JSON.parse(record.geolocation);
      const locationBoundary = record.location_boundary ? JSON.parse(record.location_boundary) : null;

      // Check if entity already exists (by original_place_id)
      const existing = await manager.query(
        `SELECT entity_id FROM entities 
         WHERE entity_type = 'Location' 
           AND properties->>'original_place_id' = $1`,
        [record.id],
      );

      if (existing.length > 0) {
        skippedCount++;
        continue;
      }

      // Create GeoJSON polygon for spatial queries
      let boundary: Record<string, unknown> | undefined;
      if (locationBoundary) {
        boundary = locationBoundary;
      } else if (geolocation.lat && geolocation.lon) {
        const offset = 0.0009; // ~100m in degrees
        boundary = {
          type: 'Polygon',
          coordinates: [
            [
              [geolocation.lon - offset, geolocation.lat - offset],
              [geolocation.lon + offset, geolocation.lat - offset],
              [geolocation.lon + offset, geolocation.lat + offset],
              [geolocation.lon - offset, geolocation.lat + offset],
              [geolocation.lon - offset, geolocation.lat - offset],
            ],
          ],
        };
      }

      const tags = record.tags
        ? record.tags
            .slice(1, -1)
            .split(',')
            .map((t) => t.trim().replace(/^'|'$/g, ''))
        : [];

      const properties: Record<string, unknown> = {
        place_type: record.type,
        geo_format: record.geo_format,
        geolocation,
        boundary,
        estimated: record.estimated,
        tracked: record.tracked,
        uploaded: record.uploaded,
        parent_id: record.parent_id || null,
        connection_id: record.connection_id || null,
        provider_id: record.provider_id || null,
        tags,
        original_place_id: record.id,
      };

      const searchContent = [record.name, record.type, ...tags].filter(Boolean).join(' ');

      const ownerUserId = record.user_id && record.user_id !== 'NULL' ? record.user_id : defaultOwnerUserId;

      await manager.query(
        `INSERT INTO entities (
          entity_id, entity_type, name, description, properties, 
          search_content, is_active, is_archived, owner_user_id,
          created_at, updated_at, last_accessed
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          uuidv7(),
          'Location',
          record.name,
          `${record.type} location`,
          JSON.stringify(properties),
          searchContent,
          true,
          false,
          ownerUserId,
          record.created_at,
          record.updated_at,
          record.updated_at,
        ],
      );
      migratedCount++;
    }
  });

  logger.log(`Migrated ${migratedCount} places to entities table (${skippedCount} already existed)`);
}
