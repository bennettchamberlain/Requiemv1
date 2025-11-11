import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Point, QueryFailedError } from 'typeorm';

import { PgErrorCode } from '@ci/common/constants';
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

    const returned: Position[] = [];
    const errors: Array<{ time: string; error: string }> = [];

    for (const item of dataArray) {
      try {
        await this.ensureDeviceExists(item.device_id, context);

        const position = this.createPositionEntity(item, context.userId!);
        const result = await this.positionRepository.save(position);
        returned.push(result.toPosition());
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          this.logger.warn('Skipping duplicate position', {
            time: item.time,
            userId: context.userId,
          });
          errors.push({ time: item.time, error: 'Duplicate position' });
          continue;
        }

        throw error;
      }
    }

    if (errors.length > 0) {
      this.logger.log('Some positions were skipped due to duplicates', {
        skippedCount: errors.length,
        createdCount: returned.length,
      });
    }

    this.logger.log('Successfully created position records', {
      userId: context.userId,
      count: returned.length,
      skipped: errors.length,
    });

    if (isSingle) {
      if (returned.length === 0) {
        throw new ConflictException('Position record already exists for this time and user');
      }

      return returned[0];
    }

    return returned;
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

    const uniquePositions = this.deduplicateByTimestamp(positions);

    if (uniquePositions.length < positions.length) {
      this.logger.log('Deduplicated iOS positions', {
        originalCount: positions.length,
        uniqueCount: uniquePositions.length,
        duplicatesRemoved: positions.length - uniquePositions.length,
      });
    }

    const positionDtos: CreatePositionDto[] = uniquePositions.map((position) =>
      this.mapIosPositionToPositionDto(position, deviceId),
    );

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

    const { whereClause, params } = this.buildGeofenceQuery(geofence, context.userId!, startDate, endDate);

    const query = `
      SELECT * FROM position
      WHERE ${whereClause}
      ORDER BY time DESC
    `;

    const rawResults = await this.positionRepository.query(query, params);

    return this.mapRawResultsToPositions(rawResults);
  }

  private async ensureDeviceExists(deviceId: string | undefined, context: RequestContext): Promise<void> {
    if (!deviceId) {
      return;
    }

    const device = await this.deviceService.findOne(context, deviceId);

    if (!device) {
      this.logger.warn('Device not found for position', {
        deviceId,
        userId: context.userId,
      });
    }
  }

  private createPositionEntity(item: CreatePositionDto, userId: string): PositionEntity {
    const location = item.location
      ? {
          type: 'Point' as const,
          coordinates: [item.location.x, item.location.y],
        }
      : null;

    return this.positionRepository.create({
      time: new Date(item.time),
      user_id: userId,
      device_id: item.device_id ?? null,
      location,
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
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION;
  }

  private deduplicateByTimestamp(positions: IosPositionDto[]): IosPositionDto[] {
    const seenTimestamps = new Map<string, IosPositionDto>();
    for (const position of positions) {
      seenTimestamps.set(position.timestamp, position);
    }

    return Array.from(seenTimestamps.values());
  }

  private mapIosPositionToPositionDto(iosPosition: IosPositionDto, deviceId?: string): CreatePositionDto {
    const source = this.normalizeSource(iosPosition.source);
    const metadata = this.extractMetadata(iosPosition);
    const heading_degrees = this.normalizeHeading(iosPosition.heading);

    return {
      time: iosPosition.timestamp,
      device_id: deviceId || undefined,
      location: {
        x: iosPosition.longitude,
        y: iosPosition.latitude,
      },
      altitude_meters: iosPosition.altitude,
      accuracy_meters: iosPosition.accuracy,
      heading_degrees,
      source,
      relative_coordinates: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  private normalizeSource(source?: string): LocationSource {
    if (!source) {
      return 'other';
    }

    const normalized = source.toLowerCase().trim();
    const validSources: LocationSource[] = ['gps', 'wifi', 'cell_tower', 'manual', 'inferred', 'other'];

    if (validSources.includes(normalized as LocationSource)) {
      return normalized as LocationSource;
    }

    if (normalized.includes('gps') || normalized.includes('satellite')) {
      return 'gps';
    }

    if (normalized.includes('wifi') || normalized.includes('network')) {
      return 'wifi';
    }

    if (normalized.includes('cell') || normalized.includes('tower')) {
      return 'cell_tower';
    }

    return 'other';
  }

  private extractMetadata(iosPosition: IosPositionDto): Record<string, unknown> {
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

    return metadata;
  }

  private normalizeHeading(heading?: number): number | undefined {
    if (heading === undefined || heading < 0 || heading > 360) {
      return undefined;
    }

    return heading;
  }

  private buildGeofenceQuery(
    geofence: Geofence,
    userId: string,
    startDate?: Date,
    endDate?: Date,
  ): { whereClause: string; params: (string | number)[] } {
    let whereClause = 'user_id = $1 AND location IS NOT NULL';
    const params: (string | number)[] = [userId];
    let paramIndex = 2;

    if ('radius_meters' in geofence) {
      const radiusGeofence = geofence as GeofenceRadius;
      whereClause += ` AND ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
        $${paramIndex + 2}
      )`;
      params.push(
        radiusGeofence.center.longitude,
        radiusGeofence.center.latitude,
        radiusGeofence.radius_meters,
      );
      paramIndex += 3;
    } else {
      const polygonGeofence = geofence as GeofencePolygon;
      if (polygonGeofence.coordinates.length < 3) {
        this.logger.warn('Polygon geofence must have at least 3 coordinates');

        return { whereClause: 'FALSE', params: [] };
      }

      const polygonWKT = this.createPolygonWKT(polygonGeofence.coordinates);
      whereClause += ` AND ST_Within(
        location::geography,
        ST_GeogFromText($${paramIndex})::geography
      )`;
      params.push(`SRID=4326;${polygonWKT}`);
      paramIndex += 1;
    }

    if (startDate) {
      whereClause += ` AND time >= $${paramIndex}`;
      params.push(startDate.toISOString());
      paramIndex += 1;
    }

    if (endDate) {
      whereClause += ` AND time <= $${paramIndex}`;
      params.push(endDate.toISOString());
    }

    return { whereClause, params };
  }

  private createPolygonWKT(coordinates: Array<{ longitude: number; latitude: number }>): string {
    const coordinatesStr = coordinates.map((coord) => `${coord.longitude} ${coord.latitude}`).join(', ');
    const firstCoord = coordinates[0];

    return `POLYGON((${coordinatesStr}, ${firstCoord.longitude} ${firstCoord.latitude}))`;
  }

  private mapRawResultsToPositions(rawResults: Array<Record<string, unknown>>): Position[] {
    return rawResults.map((row) => {
      const entity = new PositionEntity();
      entity.time = new Date(row.time as string);
      entity.user_id = row.user_id as string;
      entity.device_id = row.device_id as string | null;
      entity.location = this.parseLocation(row.location);
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
      entity.location_embedding = this.parseLocationEmbedding(row.location_embedding);
      entity.is_private = (row.is_private as boolean) ?? false;

      return entity.toPosition();
    });
  }

  private parseLocation(location: unknown): Point | null {
    if (!location) {
      return null;
    }

    if (
      typeof location === 'object' &&
      location !== null &&
      'type' in location &&
      'coordinates' in location
    ) {
      return location as Point;
    }

    if (typeof location === 'string' && location.includes('POINT')) {
      const match = location.match(/POINT\(([^)]+)\)/);
      if (match) {
        const [lon, lat] = match[1].split(' ').map(Number);

        return {
          type: 'Point',
          coordinates: [lon, lat],
        };
      }
    }

    return null;
  }

  private parseLocationEmbedding(embedding: unknown): number[] | null {
    if (!embedding) {
      return null;
    }

    if (typeof embedding === 'string') {
      return embedding.slice(1, -1).split(',').map(Number);
    }

    if (Array.isArray(embedding)) {
      return embedding as number[];
    }

    return null;
  }
}
