import { UseGuards } from '@nestjs/common';
import { Args, Float, ID, Int, Mutation, Parent, Query, Resolver, ResolveField } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { MaxArraySizePipe } from '@ci/common/pipes';
import { type PlaceKind, PlaceService } from '@ci/domains/memory';

import { PlaceLoader } from '../loaders/PlaceLoader';
import { PlaceVisitStatsLoader } from '../loaders/PlaceVisitStatsLoader';
import { TagLoader } from '../loaders/TagLoader';
import { CreatePlaceInput } from '../types/CreatePlaceInput';
import { EntityTagType } from '../types/EntityTagType';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { PlaceConnection } from '../types/PlaceConnection';
import { PlaceEdge } from '../types/PlaceEdge';
import { PlaceNearType } from '../types/PlaceNearType';
import { PlaceType } from '../types/PlaceType';
import { PlaceVisitStatsType } from '../types/PlaceVisitStatsType';
import { UpdatePlaceInput } from '../types/UpdatePlaceInput';
import { Paginator } from '../utils/Paginator';

const PLACE_KINDS: PlaceKind[] = [
  'room',
  'building',
  'venue',
  'address',
  'neighborhood',
  'city',
  'region',
  'country',
  'continent',
  'planet',
  'other',
];

function parsePlaceKind(raw: string | undefined): PlaceKind | undefined {
  if (raw == null) {
    return undefined;
  }

  return (PLACE_KINDS as string[]).includes(raw) ? (raw as PlaceKind) : undefined;
}

@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => PlaceType)
export class PlaceResolver {
  constructor(
    private readonly placeService: PlaceService,
    private readonly placeLoader: PlaceLoader,
    private readonly placeVisitStatsLoader: PlaceVisitStatsLoader,
    private readonly tagLoader: TagLoader,
  ) {}

  @Mutation(() => PlaceType)
  async createPlace(
    @Context() context: RequestContext,
    @Args('input') input: CreatePlaceInput,
  ): Promise<PlaceType> {
    const serviceContext = toServiceContext(context);

    const properties = input.properties || {};

    if (input.type) {
      properties.type = input.type;
    }

    if (input.geoFormat) {
      properties.geoFormat = input.geoFormat;
    }

    if (input.geolocation) {
      properties.geolocation = input.geolocation;
    }

    if (input.locationBoundary) {
      properties.locationBoundary = input.locationBoundary;
    }

    if (input.estimated) {
      properties.estimated = input.estimated;
    }

    if (input.tracked) {
      properties.tracked = input.tracked;
    }

    if (input.uploaded) {
      properties.uploaded = input.uploaded;
    }

    const entity = await this.placeService.create(serviceContext, {
      name: input.name,
      entity_type: 'Location',
      properties,
      description: input.description,
      ...(typeof input.latitude === 'number' && typeof input.longitude === 'number'
        ? { locationPoint: { type: 'Point' as const, coordinates: [input.longitude, input.latitude] } }
        : {}),
      ...(parsePlaceKind(input.placeKind) ? { placeKind: parsePlaceKind(input.placeKind) } : {}),
      ...(input.parentId ? { parentPlaceId: GlobalUID.parse('place', input.parentId) } : {}),
    });

    return PlaceType.toType(entity[0]);
  }

  /**
   * Batch create places in one round-trip. The clean batch equivalent of N
   * aliased createPlace mutations; returns the created rows in input order.
   */
  @Mutation(() => [PlaceType])
  async createPlaces(
    @Context() context: RequestContext,
    @Args('input', { type: () => [CreatePlaceInput] }, new MaxArraySizePipe())
    input: CreatePlaceInput[],
  ): Promise<PlaceType[]> {
    const serviceContext = toServiceContext(context);

    const places = await this.placeService.createMany(
      serviceContext,
      input.map((item) => {
        const properties = item.properties || {};

        if (item.type) {
          properties.type = item.type;
        }

        if (item.geoFormat) {
          properties.geoFormat = item.geoFormat;
        }

        if (item.geolocation) {
          properties.geolocation = item.geolocation;
        }

        if (item.locationBoundary) {
          properties.locationBoundary = item.locationBoundary;
        }

        if (item.estimated) {
          properties.estimated = item.estimated;
        }

        if (item.tracked) {
          properties.tracked = item.tracked;
        }

        if (item.uploaded) {
          properties.uploaded = item.uploaded;
        }

        return {
          name: item.name,
          entity_type: 'Location',
          properties,
          description: item.description,
          ...(typeof item.latitude === 'number' && typeof item.longitude === 'number'
            ? { locationPoint: { type: 'Point' as const, coordinates: [item.longitude, item.latitude] } }
            : {}),
          ...(parsePlaceKind(item.placeKind) ? { placeKind: parsePlaceKind(item.placeKind) } : {}),
          ...(item.parentId ? { parentPlaceId: GlobalUID.parse('place', item.parentId) } : {}),
        };
      }),
    );

    return places.map((place) => PlaceType.toType(place));
  }

  @Mutation(() => PlaceType, { nullable: true })
  async updatePlace(
    @Context() context: RequestContext,
    @Args('input') input: UpdatePlaceInput,
  ): Promise<PlaceType | null> {
    const serviceContext = toServiceContext(context);

    const properties = input.properties || {};

    if (input.type) {
      properties.type = input.type;
    }

    if (input.geoFormat) {
      properties.geoFormat = input.geoFormat;
    }

    if (input.geolocation) {
      properties.geolocation = input.geolocation;
    }

    if (input.locationBoundary) {
      properties.locationBoundary = input.locationBoundary;
    }

    if (input.estimated) {
      properties.estimated = input.estimated;
    }

    if (input.tracked) {
      properties.tracked = input.tracked;
    }

    if (input.uploaded) {
      properties.uploaded = input.uploaded;
    }

    const id = GlobalUID.parse('place', input.id);

    const entity = await this.placeService.update(serviceContext, id, {
      name: input.name,
      properties,
      description: input.description,
      ...(typeof input.latitude === 'number' && typeof input.longitude === 'number'
        ? { latitude: input.latitude, longitude: input.longitude }
        : {}),
      ...(parsePlaceKind(input.placeKind) ? { place_kind: parsePlaceKind(input.placeKind) } : {}),
      ...(input.parentId !== undefined
        ? { parent_place_id: input.parentId ? GlobalUID.parse('place', input.parentId) : null }
        : {}),
    });

    return entity ? PlaceType.toType(entity) : entity;
  }

  @Mutation(() => Boolean)
  async removePlace(@Context() context: RequestContext, @Args('id') id: string): Promise<boolean> {
    const serviceContext = toServiceContext(context);

    return this.placeService.remove(serviceContext, id);
  }

  @Query(() => PlaceConnection)
  async places(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
    @Args('query', { type: () => String, nullable: true }) query?: string,
  ): Promise<PlaceConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.placeService.findAll(serviceContext, { query: query ?? undefined });

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('place', entity.id),
    });

    const edges: PlaceEdge[] = slice.map((entity) => {
      const node = PlaceType.toType(entity);

      return {
        node,
        cursor: node.id,
      };
    });

    return {
      edges,
      pageInfo,
      totalCount,
    };
  }

  @Query(() => PlaceType, { nullable: true })
  async place(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<PlaceType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('place', gid);

    const entity = await this.placeService.findById(serviceContext, id);

    return entity ? PlaceType.toType(entity) : null;
  }

  /**
   * Places within radiusMeters of a point, nearest first — runs on the
   * location_point GIST index (issue #1811 GIS lookups).
   */
  @Query(() => [PlaceNearType])
  async placesNear(
    @Context() context: RequestContext,
    @Args('latitude', { type: () => Float }) latitude: number,
    @Args('longitude', { type: () => Float }) longitude: number,
    @Args('radiusMeters', { type: () => Float, nullable: true }) radiusMeters?: number,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<PlaceNearType[]> {
    const serviceContext = toServiceContext(context);

    const results = await this.placeService.placesNear(serviceContext, {
      lat: latitude,
      lng: longitude,
      radiusMeters: radiusMeters ?? 1000,
      limit: limit ?? undefined,
    });

    return results.map(({ distanceMeters, ...place }) => ({
      place: PlaceType.toType(place),
      distanceMeters,
    }));
  }

  @ResolveField(() => [EntityTagType])
  async tags(@Context() context: RequestContext, @Parent() parent: PlaceType): Promise<EntityTagType[]> {
    const serviceContext = toServiceContext(context);

    const tags = await this.tagLoader.load(serviceContext, {
      type: 'place',
      id: parent.__source.id,
    });

    return tags.map((tag) => EntityTagType.toType(tag));
  }

  /** Aggregated event visit stats for this place (events.location_entity_id). */
  @ResolveField(() => PlaceVisitStatsType)
  async visitStats(
    @Context() context: RequestContext,
    @Parent() parent: PlaceType,
  ): Promise<PlaceVisitStatsType> {
    const serviceContext = toServiceContext(context);

    const stats = await this.placeVisitStatsLoader.load(serviceContext, parent.__source.id);

    return PlaceVisitStatsType.toType(stats);
  }

  /** The containing place (city/region/country chain), when known. */
  @ResolveField(() => PlaceType, { nullable: true })
  async parent(@Context() context: RequestContext, @Parent() parent: PlaceType): Promise<PlaceType | null> {
    const parentPlaceId = parent.__source.parentPlaceId;
    if (!parentPlaceId) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const place = await this.placeLoader.load(serviceContext, parentPlaceId);

    return place ? PlaceType.toType(place) : null;
  }
}
