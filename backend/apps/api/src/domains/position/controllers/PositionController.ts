import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { PgErrorCode } from '@ci/common/constants';
import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';

import { PositionService } from '../services/PositionService';
import {
  CreatePositionDto,
  Position,
  createPositionSchema,
  Geofence,
  GeofenceRadius,
  GeofencePolygon,
  IosPositionListDto,
  iosPositionListSchema,
} from '../types';

@Controller('position')
export class PositionController {
  constructor(private readonly positionService: PositionService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createPositionSchema))
    input: CreatePositionDto | CreatePositionDto[],
  ): Promise<Position | Position[]> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to create position');
    }

    try {
      return await this.positionService.create(context, input);
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        throw new ConflictException('Position record already exists for this time and user');
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('ios')
  async createFromIosPositions(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(iosPositionListSchema))
    input: IosPositionListDto,
    @Query('deviceId') deviceId?: string,
  ): Promise<Position[]> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to create positions');
    }

    if (!input.content || input.content.length === 0) {
      throw new BadRequestException('Content array must contain at least one location');
    }

    try {
      return await this.positionService.createFromIosPositions(context, input.content, deviceId);
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        throw new ConflictException('One or more position records already exist for this time and user');
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('range')
  async findByDateRange(
    @Context() context: RequestContext,
    @Query('start') start: string,
    @Query('end') end: string,
  ): Promise<Position[]> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to view positions');
    }

    if (!start || !end) {
      throw new BadRequestException('Start and end date parameters are required');
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format. Use ISO 8601 format.');
    }

    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    return this.positionService.findByDateRange(context, startDate, endDate);
  }

  @UseGuards(JwtAuthGuard)
  @Get('geofence')
  async findByGeofence(
    @Context() context: RequestContext,
    @Query('type') type: 'radius' | 'polygon',
    @Query('centerLon') centerLon?: string,
    @Query('centerLat') centerLat?: string,
    @Query('radius') radius?: string,
    @Query('coordinates') coordinates?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ): Promise<Position[]> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to view positions');
    }

    if (!type || (type !== 'radius' && type !== 'polygon')) {
      throw new BadRequestException('Geofence type must be either "radius" or "polygon"');
    }

    let geofence: Geofence;

    if (type === 'radius') {
      if (!centerLon || !centerLat || !radius) {
        throw new BadRequestException('Radius geofence requires centerLon, centerLat, and radius parameters');
      }

      const lon = parseFloat(centerLon);
      const lat = parseFloat(centerLat);
      const radiusMeters = parseFloat(radius);

      if (isNaN(lon) || isNaN(lat) || isNaN(radiusMeters)) {
        throw new BadRequestException('Invalid numeric values for radius geofence');
      }

      if (radiusMeters <= 0) {
        throw new BadRequestException('Radius must be greater than 0');
      }

      geofence = {
        center: {
          longitude: lon,
          latitude: lat,
        },
        radius_meters: radiusMeters,
      } as GeofenceRadius;
    } else {
      // polygon
      if (!coordinates) {
        throw new BadRequestException('Polygon geofence requires coordinates parameter (JSON array)');
      }

      let coordsArray: Array<{ longitude: number; latitude: number }>;
      try {
        coordsArray = JSON.parse(coordinates);
      } catch {
        throw new BadRequestException('Invalid JSON format for coordinates');
      }

      if (!Array.isArray(coordsArray) || coordsArray.length < 3) {
        throw new BadRequestException('Coordinates must be an array with at least 3 points');
      }

      const validCoords = coordsArray.every(
        (coord) =>
          typeof coord === 'object' &&
          coord !== null &&
          typeof coord.longitude === 'number' &&
          typeof coord.latitude === 'number' &&
          !isNaN(coord.longitude) &&
          !isNaN(coord.latitude),
      );

      if (!validCoords) {
        throw new BadRequestException('Each coordinate must have valid longitude and latitude numbers');
      }

      geofence = {
        coordinates: coordsArray,
      } as GeofencePolygon;
    }

    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (start) {
      startDate = new Date(start);
      if (isNaN(startDate.getTime())) {
        throw new BadRequestException('Invalid start date format. Use ISO 8601 format.');
      }
    }

    if (end) {
      endDate = new Date(end);
      if (isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid end date format. Use ISO 8601 format.');
      }
    }

    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    return this.positionService.findByGeofence(context, geofence, startDate, endDate);
  }
}
