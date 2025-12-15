import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

interface LocationCsvRecord {
  id: string;
  identifier: string;
  datetime: Date;
  geo_format: string;
  geolocation: string;
  estimated: boolean;
  tracked: boolean;
  uploaded: boolean;
  place_id: string;
  user_id: string;
  connection_id: string;
  provider_id: string;
  tags: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Migrate locations from old schema to position hypertable
 * Includes spatial matching with place entities
 */
export async function migrateLocationsToPosition(db: DataSource, filePath: string) {
  const records = readCsv<LocationCsvRecord>(filePath);

  // Track duplicates by (time, user_id) to drop them
  const seen = new Set<string>();
  const uniqueRecords: LocationCsvRecord[] = [];

  for (const record of records) {
    const key = `${record.datetime.toISOString()}-${record.user_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRecords.push(record);
    } else {
      logger.warn(`Dropping duplicate location: ${key}`);
    }
  }

  let migratedCount = 0;
  let skippedCount = 0;

  await db.transaction(async (manager) => {
    for (const record of uniqueRecords) {
      // Check if position already exists
      const existing = await manager.query(`SELECT 1 FROM ci.position WHERE time = $1 AND user_id = $2`, [
        record.datetime,
        record.user_id,
      ]);

      if (existing.length > 0) {
        skippedCount++;
        continue; // Skip if already exists
      }

      const geolocation = JSON.parse(record.geolocation);

      // Determine source type from provider_id
      let source = 'other';
      if (record.provider_id) {
        const providerId = record.provider_id.toLowerCase();
        if (providerId.includes('gps') || providerId.includes('google') || providerId.includes('maps')) {
          source = 'gps';
        } else if (providerId.includes('manual') || providerId === 'user_defined_manual') {
          source = 'manual';
        } else if (providerId.includes('osm') || providerId.includes('import')) {
          source = 'inferred';
        }
      }

      // Create PostGIS point for location
      const lat = geolocation.lat;
      const lon = geolocation.lon;
      const alt = geolocation.alt || null;
      const heading = geolocation.orientation || null;

      // Try to find matching location entity from places
      // Match based on spatial intersection with place boundaries
      const matchingEntities = await manager.query(
        `SELECT entity_id, properties
         FROM ci.entities
         WHERE entity_type = 'Location'
           AND properties->>'original_place_id' IS NOT NULL
         LIMIT 1000`, // Get all location entities for matching
      );

      let locationEntityId: string | null = null;

      // Check if this location point intersects any place boundary
      for (const entity of matchingEntities) {
        const props = entity.properties;
        if (props.boundary && props.boundary.type === 'Polygon') {
          // Simple point-in-polygon check
          const polygon = props.boundary.coordinates[0];
          if (pointInPolygon(lon, lat, polygon)) {
            locationEntityId = entity.entity_id;
            break;
          }
        }
      }

      // Insert into position table
      await manager.query(
        `INSERT INTO ci.position (
          time, user_id, location, altitude_meters,
          accuracy_meters, heading_degrees, source,
          location_entity_id, is_private
        ) VALUES (
          $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5,
          $6, $7, $8::ci.location_source, $9, $10
        )`,
        [
          record.datetime,
          record.user_id,
          lon,
          lat,
          alt,
          null, // accuracy_meters - not in old schema
          heading,
          source,
          locationEntityId,
          false,
        ],
      );
      migratedCount++;
    }
  });

  logger.log(
    `Migrated ${migratedCount} locations to position table (${skippedCount} already existed, ${records.length - uniqueRecords.length} duplicates dropped)`,
  );
}

/**
 * Point-in-polygon test using ray casting algorithm
 */
function pointInPolygon(x: number, y: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}
