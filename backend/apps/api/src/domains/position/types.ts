import { z } from 'zod';

import type {
  Position,
  LocationSource,
  RelativeCoordinates,
  RelativeOrientation,
} from './entities/PositionEntity';

export interface Coordinate {
  longitude: number;
  latitude: number;
}

export interface GeofenceRadius {
  center: Coordinate;
  radius_meters: number;
}

export interface GeofencePolygon {
  coordinates: Coordinate[];
}

export type Geofence = GeofenceRadius | GeofencePolygon;

export const createPositionSchemaRoot = z.object({
  time: z.string().datetime(),
  device_id: z.string().uuid().optional(),
  location: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  altitude_meters: z.number().optional(),
  accuracy_meters: z.number().positive().optional(),
  hdop: z.number().optional(),
  vdop: z.number().optional(),
  heading_degrees: z.number().min(0).max(360).optional(),
  speed_meters_per_second: z.number().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  provider: z.string().optional(),
  source: z.enum(['gps', 'wifi', 'cell_tower', 'manual', 'inferred', 'other']),
  activity_type: z.string().optional(),
  location_entity_id: z.string().uuid().optional(),
  reference_entity_id: z.string().uuid().optional(),
  relative_coordinates: z.record(z.unknown()).optional(),
  relative_orientation: z.record(z.unknown()).optional(),
  location_embedding: z.array(z.number()).optional(),
  is_private: z.boolean().optional(),
});

export const createPositionSchema = z.union([createPositionSchemaRoot, z.array(createPositionSchemaRoot)]);

export const updatePositionSchema = createPositionSchemaRoot.partial();

export interface CreatePositionDto {
  time: string;
  device_id?: string;
  location?: {
    x: number;
    y: number;
  };
  altitude_meters?: number;
  accuracy_meters?: number;
  hdop?: number;
  vdop?: number;
  heading_degrees?: number;
  speed_meters_per_second?: number;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  postal_code?: string;
  name?: string;
  description?: string;
  provider?: string;
  source: LocationSource;
  activity_type?: string;
  location_entity_id?: string;
  reference_entity_id?: string;
  relative_coordinates?: RelativeCoordinates | Record<string, unknown>;
  relative_orientation?: RelativeOrientation | Record<string, unknown>;
  location_embedding?: number[];
  is_private?: boolean;
}

export interface UpdatePositionDto {
  time?: string;
  device_id?: string;
  location?: {
    x: number;
    y: number;
  };
  altitude_meters?: number;
  accuracy_meters?: number;
  hdop?: number;
  vdop?: number;
  heading_degrees?: number;
  speed_meters_per_second?: number;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  postal_code?: string;
  name?: string;
  description?: string;
  provider?: string;
  source?: LocationSource;
  activity_type?: string;
  location_entity_id?: string;
  reference_entity_id?: string;
  relative_coordinates?: RelativeCoordinates | Record<string, unknown>;
  relative_orientation?: RelativeOrientation | Record<string, unknown>;
  location_embedding?: number[];
  is_private?: boolean;
}

export interface IosPositionDto {
  id?: string;
  name?: string;
  description?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  timestamp: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  postalCode?: string;
  provider?: string;
  isFromMockProvider?: boolean;
  source?: string;
}

export interface IosPositionListDto {
  content: IosPositionDto[];
}

export const iosPositionSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  altitude: z.number().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  timestamp: z.string().datetime(),
  address: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  provider: z.string().optional(),
  isFromMockProvider: z.boolean().optional(),
  source: z.string().optional(),
});

export const iosPositionListSchema = z.object({
  content: z.array(iosPositionSchema),
});

export type { Position, LocationSource, RelativeCoordinates, RelativeOrientation };
