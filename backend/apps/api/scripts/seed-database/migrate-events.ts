import path from 'path';

import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { readCsv } from './utils';

const logger = new Logger(path.basename(__filename));

interface EventCsvRecord {
  id: string;
  type: string;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  related_objects: string;
  data_source: string;
  user_id: string;
  connection_id: string;
  provider_id: string;
  created_at: string;
  updated_at: string;
}

/**
 * Map old event type to new event_type and category
 */
function mapEventType(oldType: string): { eventType: string; category: string } {
  const lowerType = oldType.toLowerCase();

  if (lowerType.includes('visit')) {
    return { eventType: 'visit', category: 'location_visit' };
  }

  if (lowerType.includes('edit') || lowerType.includes('create')) {
    return { eventType: 'work', category: 'document_edit' };
  }

  if (lowerType.includes('call')) {
    return { eventType: 'meeting', category: 'phone_call' };
  }

  if (lowerType.includes('message')) {
    return { eventType: 'communication', category: 'message' };
  }

  if (lowerType.includes('travel')) {
    return { eventType: 'travel', category: 'commute' };
  }

  return { eventType: 'other', category: oldType };
}

/**
 * Determine source_type and source_system from data_source and provider_id
 */
function determineSource(
  dataSource: string,
  providerId: string,
): { sourceType: string; sourceSystem: string } {
  const source = (dataSource || providerId || '').toLowerCase();

  if (source.includes('calendar')) {
    return { sourceType: 'calendar_import', sourceSystem: source };
  }

  if (source.includes('manual') || source.includes('user')) {
    return { sourceType: 'manual_entry', sourceSystem: 'user_input' };
  }

  if (source.includes('sensor') || source.includes('gps') || source.includes('badge')) {
    return { sourceType: 'sensor_inference', sourceSystem: source };
  }

  return { sourceType: 'ETL', sourceSystem: dataSource || providerId || 'legacy_import' };
}

/**
 * Migrate events from old schema to new events table
 */
export async function migrateEvents(db: DataSource, filePath: string) {
  const records = readCsv<EventCsvRecord>(filePath);
  let migratedCount = 0;
  let skippedCount = 0;

  await db.transaction(async (manager) => {
    for (const record of records) {
      // Check if event already exists (by original_event_id)
      const existing = await manager.query(
        `SELECT event_id FROM ci.events
         WHERE metadata->>'original_event_id' = $1`,
        [record.id],
      );

      if (existing.length > 0) {
        skippedCount++;
        continue; // Skip if already migrated
      }

      const { eventType, category } = mapEventType(record.type);
      const { sourceType, sourceSystem } = determineSource(record.data_source, record.provider_id);

      // Parse dates - use created_at/updated_at as fallback for start/end times
      // In the CSV, start_time/end_time are empty, but created_at/updated_at contain the event times
      const createdAt = record.created_at ? new Date(record.created_at) : new Date();
      const updatedAt = record.updated_at ? new Date(record.updated_at) : new Date();

      // Ensure proper time ordering: start_time must be <= end_time
      let startTime: Date;
      let endTime: Date;

      if (record.start_time && record.end_time) {
        startTime = new Date(record.start_time);
        endTime = new Date(record.end_time);
      } else if (record.start_time) {
        startTime = new Date(record.start_time);
        endTime = updatedAt;
      } else if (record.end_time) {
        startTime = createdAt;
        endTime = new Date(record.end_time);
      } else {
        // Both empty - use created/updated but ensure correct order
        startTime = createdAt < updatedAt ? createdAt : updatedAt;
        endTime = createdAt < updatedAt ? updatedAt : createdAt;
      }

      // Parse related_objects for metadata
      const metadata: Record<string, unknown> = {
        original_event_id: record.id,
        connection_id: record.connection_id || null,
      };

      if (record.related_objects) {
        try {
          let parsed: string[] | unknown;
          if (record.related_objects.startsWith('[') && record.related_objects.endsWith(']')) {
            const items = record.related_objects
              .slice(1, -1)
              .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
              .map((item) => item.trim().replace(/^["']|["']$/g, ''));
            parsed = items;
          } else {
            parsed = JSON.parse(record.related_objects.replace(/'/g, '"'));
          }

          metadata.related_objects = parsed;
        } catch {
          metadata.related_objects = record.related_objects;
        }
      }

      // Insert into events table
      await manager.query(
        `INSERT INTO ci.events (
          event_id, user_id, start_time, end_time, title, description,
          event_type, category, source_type, source_system, source_id,
          confidence_score, is_recurring, is_all_day, is_private,
          is_predicted, is_inferred, metadata, status, is_deleted,
          created_at, updated_at, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
        )`,
        [
          uuidv7(),
          record.user_id,
          startTime,
          endTime,
          record.name || 'Untitled Event',
          record.description || null,
          eventType,
          category,
          sourceType,
          sourceSystem,
          record.provider_id || null,
          sourceType === 'sensor_inference' ? 0.8 : 1.0, // Lower confidence for inferred
          false, // is_recurring
          false, // is_all_day
          false, // is_private
          false, // is_predicted
          sourceType === 'sensor_inference', // is_inferred
          JSON.stringify(metadata),
          'completed', // status
          false, // is_deleted
          createdAt,
          updatedAt,
          'migration_script',
        ],
      );
      migratedCount++;
    }
  });

  logger.log(`Migrated ${migratedCount} events to events table (${skippedCount} already existed)`);
}
