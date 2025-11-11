import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Point } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import { DeviceService } from '@ci/domains/devices';

import { PositionEntity, LocationSource } from '../entities/PositionEntity';
import type {
  CreatePositionDto,
  Position,
  Geofence,
  GeofenceRadius,
  GeofencePolygon,
  IosPositionDto,
} from '../types';

@Injectable()
export class PositionService {
  private logger = new LoggerService(PositionService.name);

  constructor(
    @InjectRepository(PositionEntity)
    private readonly positionRepository: Repository<PositionEntity>,
    private readonly deviceService: DeviceService,
  ) {}

  private async ensureDeviceExists(deviceId: string | undefined, context: RequestContext): Promise<void> {
    if (!deviceId) {
      return;
    }

    // Check if device exists
    const device = await this.deviceService.findOne(context, deviceId);

    if (!device) {
      this.logger.warn('Device not found for position', {
        deviceId,
        userId: context.userId,
      });
    }
  }

  async create(
    context: RequestContext,
    data: CreatePositionDto | CreatePositionDto[],
  ): Promise<Position | Position[]> {
    const isSingle = !Array.isArray(data);
    const dataArray: CreatePositionDto[] = isSingle ? [data] : data;

    this.logger.log('Creating position records', {
      userId: context.userId,
      count: dataArray.length,
    });

    const returned = await Promise.all(
      dataArray.map(async (item) => {
        // Ensure device exists if provided
        await this.ensureDeviceExists(item.device_id, context);

        // Convert location coordinates to PostGIS Point if provided
        let location: Point | null = null;
        if (item.location) {
          location = {
            type: 'Point',
            coordinates: [item.location.x, item.location.y], // [longitude, latitude]
          };
        }

        const position = this.positionRepository.create({
          time: new Date(item.time),
          user_id: context.userId!,
          device_id: item.device_id ?? null,
          location: location,
          altitude_meters: item.altitude_meters ?? null,
          accuracy_meters: item.accuracy_meters ?? null,
          hdop: item.hdop ?? null,
          vdop: item.vdop ?? null,
          heading_degrees: item.heading_degrees ?? null,
          source: item.source,
          activity_type: item.activity_type ?? null,
          location_entity_id: item.location_entity_id ?? null,
          reference_entity_id: item.reference_entity_id ?? null,
          relative_coordinates: item.relative_coordinates ?? {},
          relative_orientation: item.relative_orientation ?? {},
          location_embedding: item.location_embedding ?? null,
          is_private: item.is_private ?? false,
        });

        const result = await this.positionRepository.save(position);

        return result.toPosition();
      }),
    );

    this.logger.log('Successfully created position records', {
      userId: context.userId,
      count: returned.length,
    });

    return isSingle ? returned[0] : returned;
  }

  /**
   * Maps iOS position format to internal CreatePositionDto
   * Fields that don't map directly are stored in relative_coordinates as metadata
   */
  private mapIosPositionToPositionDto(iosPosition: IosPositionDto, deviceId?: string): CreatePositionDto {
    // Map source - try to match to LocationSource enum, default to 'other' if not recognized
    let source: LocationSource = 'other';
    if (iosPosition.source) {
      const normalizedSource = iosPosition.source.toLowerCase().trim();
      if (['gps', 'wifi', 'cell_tower', 'manual', 'inferred', 'other'].includes(normalizedSource)) {
        source = normalizedSource as LocationSource;
      } else {
        // Try to infer from provider or other fields
        if (normalizedSource.includes('gps') || normalizedSource.includes('satellite')) {
          source = 'gps';
        } else if (normalizedSource.includes('wifi') || normalizedSource.includes('network')) {
          source = 'wifi';
        } else if (normalizedSource.includes('cell') || normalizedSource.includes('tower')) {
          source = 'cell_tower';
        }
      }
    }

    // Store unmapped fields in relative_coordinates as metadata
    const metadata: Record<string, unknown> = {};
    if (iosPosition.id) {
      metadata.id = iosPosition.id;
    }

    if (iosPosition.name) {
      metadata.name = iosPosition.name;
    }

    if (iosPosition.description) {
      metadata.description = iosPosition.description;
    }

    if (iosPosition.speed !== undefined) {
      metadata.speed = iosPosition.speed;
    }

    if (iosPosition.address) {
      metadata.address = iosPosition.address;
    }

    if (iosPosition.city) {
      metadata.city = iosPosition.city;
    }

    if (iosPosition.region) {
      metadata.region = iosPosition.region;
    }

    if (iosPosition.country) {
      metadata.country = iosPosition.country;
    }

    if (iosPosition.postalCode) {
      metadata.postalCode = iosPosition.postalCode;
    }

    if (iosPosition.provider) {
      metadata.provider = iosPosition.provider;
    }

    if (iosPosition.isFromMockProvider !== undefined) {
      metadata.isFromMockProvider = iosPosition.isFromMockProvider;
    }

    return {
      time: iosPosition.timestamp,
      device_id: deviceId || iosPosition.id, // Use id as device_id if no device_id provided
      location: {
        x: iosPosition.longitude,
        y: iosPosition.latitude,
      },
      altitude_meters: iosPosition.altitude,
      accuracy_meters: iosPosition.accuracy,
      heading_degrees: iosPosition.heading,
      source: source,
      relative_coordinates: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  async createFromIosPositions(
    context: RequestContext,
    positions: IosPositionDto[],
    deviceId?: string,
  ): Promise<Position[]> {
    this.logger.log('Creating position records from iOS positions', {
      userId: context.userId,
      count: positions.length,
    });

    // Map iOS positions to internal DTOs
    const positionDtos: CreatePositionDto[] = positions.map((position) =>
      this.mapIosPositionToPositionDto(position, deviceId),
    );

    // Use existing create method
    const result = await this.create(context, positionDtos);

    return Array.isArray(result) ? result : [result];
  }

  async findByDateRange(context: RequestContext, start: Date, end: Date): Promise<Position[]> {
    this.logger.log('Fetching positions for date range', {
      userId: context.userId,
      start: start.toISOString(),
      end: end.toISOString(),
    });

    const results = await this.positionRepository.find({
      where: {
        user_id: context.userId!,
        time: Between(start, end),
      },
      order: { time: 'DESC' },
    });

    return results.map((entity) => entity.toPosition());
  }

  async findByGeofence(
    context: RequestContext,
    geofence: Geofence,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Position[]> {
    this.logger.log('Fetching positions within geofence', {
      userId: context.userId,
      geofenceType: 'radius' in geofence ? 'radius' : 'polygon',
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
    });

    let whereClause = 'user_id = $1 AND location IS NOT NULL';
    const params: (string | number)[] = [context.userId!];
    let paramIndex = 2;

    // Build geofence query based on type
    if ('radius_meters' in geofence) {
      // Radius-based geofence using ST_DWithin
      const radiusGeofence = geofence as GeofenceRadius;
      whereClause += ` AND ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
        $${paramIndex + 2}
      )`;
      params.push(radiusGeofence.center.longitude);
      params.push(radiusGeofence.center.latitude);
      params.push(radiusGeofence.radius_meters);
      paramIndex += 3;
    } else {
      // Polygon-based geofence using ST_Within
      const polygonGeofence = geofence as GeofencePolygon;
      if (polygonGeofence.coordinates.length < 3) {
        this.logger.warn('Polygon geofence must have at least 3 coordinates');

        return [];
      }

      // Create polygon WKT (Well-Known Text) format
      const coordinatesStr = polygonGeofence.coordinates
        .map((coord) => `${coord.longitude} ${coord.latitude}`)
        .join(', ');
      // Close the polygon by repeating the first coordinate
      const firstCoord = polygonGeofence.coordinates[0];
      const polygonWKT = `POLYGON((${coordinatesStr}, ${firstCoord.longitude} ${firstCoord.latitude}))`;

      whereClause += ` AND ST_Within(
        location::geography,
        ST_GeogFromText($${paramIndex})::geography
      )`;
      params.push(`SRID=4326;${polygonWKT}`);
      paramIndex += 1;
    }

    // Add date range filter if provided
    if (startDate) {
      whereClause += ` AND time >= $${paramIndex}`;
      params.push(startDate.toISOString());
      paramIndex += 1;
    }

    if (endDate) {
      whereClause += ` AND time <= $${paramIndex}`;
      params.push(endDate.toISOString());
      paramIndex += 1;
    }

    const query = `
      SELECT * FROM position
      WHERE ${whereClause}
      ORDER BY time DESC
    `;

    const rawResults = await this.positionRepository.query(query, params);

    // Convert raw results to entities and then to Position DTOs
    // Raw query results need to be manually mapped to entity format
    const entities = rawResults.map((row: Record<string, unknown>) => {
      // Map raw database row to entity
      const entity = new PositionEntity();
      entity.time = new Date(row.time as string);
      entity.user_id = row.user_id as string;
      entity.device_id = row.device_id as string | null;

      // Handle location Point - convert from PostGIS format
      if (row.location) {
        // PostGIS returns location as a string in WKT format or as coordinates
        // TypeORM Point format is { type: 'Point', coordinates: [lon, lat] }
        // We'll need to parse it based on how PostGIS returns it
        const locationStr = row.location as string;
        // If it's already in the right format from the query, use it
        // Otherwise, we may need to parse WKT
        if (typeof locationStr === 'string' && locationStr.includes('POINT')) {
          // Parse WKT format: POINT(lon lat)
          const match = locationStr.match(/POINT\(([^)]+)\)/);
          if (match) {
            const [lon, lat] = match[1].split(' ').map(Number);
            entity.location = {
              type: 'Point',
              coordinates: [lon, lat],
            };
          }
        } else if (row.location && typeof row.location === 'object') {
          entity.location = row.location as Point;
        }
      } else {
        entity.location = null;
      }

      entity.altitude_meters = row.altitude_meters as number | null;
      entity.accuracy_meters = row.accuracy_meters as number | null;
      entity.hdop = row.hdop as number | null;
      entity.vdop = row.vdop as number | null;
      entity.heading_degrees = row.heading_degrees as number | null;
      entity.source = row.source as LocationSource;
      entity.activity_type = row.activity_type as string | null;
      entity.location_entity_id = row.location_entity_id as string | null;
      entity.reference_entity_id = row.reference_entity_id as string | null;
      entity.relative_coordinates = (row.relative_coordinates as Record<string, unknown>) || {};
      entity.relative_orientation = (row.relative_orientation as Record<string, unknown>) || {};

      // Handle location_embedding - parse from string format if needed
      if (row.location_embedding) {
        if (typeof row.location_embedding === 'string') {
          entity.location_embedding = row.location_embedding.slice(1, -1).split(',').map(Number);
        } else {
          entity.location_embedding = row.location_embedding as number[];
        }
      } else {
        entity.location_embedding = null;
      }

      entity.is_private = (row.is_private as boolean) ?? false;

      return entity;
    });

    return entities.map((entity: PositionEntity) => entity.toPosition());
  }
}
