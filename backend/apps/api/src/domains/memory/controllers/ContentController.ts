import {
  ConflictException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { z } from 'zod';

import { PgErrorCode } from '@ci/common/constants';
import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';

import { ContentService } from '../services/ContentService';
import { CreateContentDto, UpdateContentDto } from '../types';

const createContentSchema = z.object({

});

const updateContentSchema = z.object({
});

@Controller('contents')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Body(new ValidationPipe(createContentSchema)) input: CreateContentDto) {
    try {
      return await this.contentService.create(input);
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        // TODO: Obfuscate this error message? We're revealing DB details here.
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Context() context: RequestContext) {
    const userId = context.userId;
    console.log('userId', userId)
    return this.contentService.findAll({
      where: {
        user_id: userId
      }
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contentService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body(new ValidationPipe(updateContentSchema)) input: UpdateContentDto) {
    try {
      return await this.contentService.update(id, input);
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        // TODO: Obfuscate this error message? We're revealing DB details here.
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contentService.remove(id);
  }
}
