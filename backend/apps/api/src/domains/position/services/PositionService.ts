import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Point, In } from 'typeorm';

import { InvalidSystemUserOperationException } from '@ci/common/exceptions';
import { LoggerService } from '@ci/common/services';
import { SYSTEM_USER, type ServiceContext } from '@ci/common/types';
import { DeviceService } from '@ci/domains/devices';

import { PositionEntity, LocationSource } from '../entities/PositionEntity';
import type { CreatePositionDto, Position, Geofence, GeofenceRadius, GeofencePolygon } from '../types';

@Injectable()
export class PositionService {
  private logger = new LoggerService(PositionService.name);

  constructor(
    @InjectRepository(PositionEntity)
    private readonly positionRepository: Repository<PositionEntity>,
    private readonly deviceService: DeviceService,
  ) {}

  async create(context: ServiceContext, data: CreatePositionDto[]): Promise<Position[]> {
    if (context.userId === SYSTEM_USER) {
      throw new InvalidSystemUserOperationException();
    }

    this.logger.log('Creating position records', {
      userId: context.userId,
      count: data.length,
    });

    const uniquePositions = this.deduplicateByTime(data);

    if (uniquePositions.length < data.length) {
      this.logger.log('Deduplicated positions', {
        originalCount: data.length,
        uniqueCount: uniquePositions.length,
        duplicatesRemoved: data.length - uniquePositions.length,
      });
    }

    const times = uniquePositions.map((item) => new Date(item.time));
    const existingPositions = await this.findExistingByTimes(context, times);
    const existingTimesSet = new Set(existingPositions.map((p) => p.time.toISOString()));
    const newPositions: CreatePositionDto[] = [];

    for (const item of uniquePositions) {
      const itemTime = new Date(item.time).toISOString();

      if (!existingTimesSet.has(itemTime)) {
        if (item.device_id) {
          const device = await this.deviceService.findById(context, item.device_id);

          if (!device) {
            this.logger.warn('Device not found for position', {
              deviceId: item.device_id,
              userId: context.userId,
            });
          }
        }

        const normalizedItem = {
          ...item,
          heading_degrees: this.normalizeHeading(item.heading_degrees),
        };

        newPositions.push(normalizedItem);
      }
    }

    const createdEntities: PositionEntity[] = [];

    if (newPositions.length > 0) {
      const entitiesToSave = newPositions.map((item) => this.createPositionEntity(context, item));
      const saved = await this.positionRepository.save(entitiesToSave);
      createdEntities.push(...saved);
    }

    const allPositions = [...existingPositions, ...createdEntities]
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .map((entity) => entity.toPosition());

    this.logger.log('Successfully processed position records', {
      userId: context.userId,
      totalCount: allPositions.length,
      newCount: createdEntities.length,
      existingCount: existingPositions.length,
    });

    return allPositions;
  }

  async findByDateRange(context: ServiceContext, start: Date, end: Date): Promise<Position[]> {
    this.logger.log('Fetching positions for date range', {
      userId: context.userId,
      start: start.toISOString(),
      end: end.toISOString(),
    });

    const results = await this.positionRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
        time: Between(start, end),
      },
      order: { time: 'DESC' },
    });

    return results.map((entity) => entity.toPosition());
  }

  async findByGeofence(
    context: ServiceContext,
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

    let whereClause = 'location IS NOT NULL';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    // Only filter by user_id if not system user
    if (context.userId !== SYSTEM_USER) {
      whereClause += ` AND user_id = $${paramIndex}`;
      params.push(context.userId);
      paramIndex++;
    }

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

        return [];
      }

      const coordinatesStr = polygonGeofence.coordinates
        .map((coord) => `${coord.longitude} ${coord.latitude}`)
        .join(', ');
      const firstCoord = polygonGeofence.coordinates[0];
      const polygonWKT = `POLYGON((${coordinatesStr}, ${firstCoord.longitude} ${firstCoord.latitude}))`;

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

    const rawResults = await this.positionRepository.query(
      `SELECT * FROM position WHERE ${whereClause} ORDER BY time DESC`,
      params,
    );

    return this.mapRawResultsToPositions(rawResults);
  }

  private createPositionEntity(context: ServiceContext, item: CreatePositionDto): PositionEntity {
    if (context.userId === SYSTEM_USER) {
      throw new InvalidSystemUserOperationException();
    }

    const location = item.location
      ? {
          type: 'Point' as const,
          coordinates: [item.location.x, item.location.y],
        }
      : null;

    return this.positionRepository.create({
      time: new Date(item.time),
      user_id: context.userId,
      device_id: item.device_id ?? null,
      location,
      altitude_meters: item.altitude_meters ?? null,
      accuracy_meters: item.accuracy_meters ?? null,
      hdop: item.hdop ?? null,
      vdop: item.vdop ?? null,
      heading_degrees: item.heading_degrees ?? null,
      speed_meters_per_second: item.speed_meters_per_second ?? null,
      address: item.address ?? null,
      city: item.city ?? null,
      region: item.region ?? null,
      country: item.country ?? null,
      postal_code: item.postal_code ?? null,
      name: item.name ?? null,
      description: item.description ?? null,
      provider: item.provider ?? null,
      source: item.source,
      activity_type: item.activity_type ?? null,
      location_entity_id: item.location_entity_id ?? null,
      reference_entity_id: item.reference_entity_id ?? null,
      relative_coordinates: item.relative_coordinates ?? {},
      relative_orientation: item.relative_orientation ?? {},
    });
  }

  private async findExistingByTimes(context: ServiceContext, times: Date[]): Promise<PositionEntity[]> {
    if (context.userId === SYSTEM_USER) {
      throw new InvalidSystemUserOperationException();
    }

    if (times.length === 0) {
      return [];
    }

    return this.positionRepository.find({
      where: {
        user_id: context.userId,
        time: In(times),
      },
    });
  }

  private deduplicateByTime(positions: CreatePositionDto[]): CreatePositionDto[] {
    const seenTimes = new Map<string, CreatePositionDto>();
    for (const position of positions) {
      seenTimes.set(position.time, position);
    }

    return Array.from(seenTimes.values());
  }

  private normalizeHeading(heading?: number): number | undefined {
    if (heading === undefined || heading < 0 || heading > 360) {
      return undefined;
    }

    return heading;
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
      entity.speed_meters_per_second = row.speed_meters_per_second as number | null;
      entity.address = row.address as string | null;
      entity.city = row.city as string | null;
      entity.region = row.region as string | null;
      entity.country = row.country as string | null;
      entity.postal_code = row.postal_code as string | null;
      entity.name = row.name as string | null;
      entity.description = row.description as string | null;
      entity.provider = row.provider as string | null;
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
