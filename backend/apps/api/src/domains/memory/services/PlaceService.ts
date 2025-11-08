import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { RequestContext } from '@ci/common/types';

import { PlaceEntity } from '../entities/PlaceEntity';
import { type CreatePlaceDto } from '../types';

@Injectable()
export class PlaceService {
  constructor(
    @InjectRepository(PlaceEntity)
    private readonly placeRepository: Repository<PlaceEntity>,
  ) {}

  async create(context: RequestContext, data: CreatePlaceDto | CreatePlaceDto[]): Promise<PlaceEntity[]> {
    const isSingle = !Array.isArray(data);
    const dataArray: CreatePlaceDto[] = isSingle ? [data] : data;

    const returned = await Promise.all(
      dataArray.map(async (item) => {
        const place = await this.placeRepository.create({
          ...item,
          id: uuidv7(),
          user: {
            id: context.userId,
          },
        });

        const placeResult = await this.placeRepository.save(place);

        return placeResult;
      }),
    );

    return returned;
  }

  async findAll(context: RequestContext): Promise<PlaceEntity[]> {
    const result = await this.placeRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
    });

    return result;
  }

  async findOne(context: RequestContext, id: string): Promise<PlaceEntity | null> {
    const result = await this.placeRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
    });

    return result ?? null;
  }
}
