import {
  ConflictException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { PgErrorCode } from '@ci/common/constants';
import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';

import { ContentService } from '../services/ContentService';
import { CreateContentDto, UpdateContentDto, createContentSchema, updateContentSchema } from '../types';

@Controller('contents')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Req() req: Request,
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createContentSchema)) input: CreateContentDto | CreateContentDto[],
  ) {
    const serviceContext = toServiceContext(context);

    try {
      if (context.userId) {
        if (Array.isArray(input)) {
          input = input.map((item) => {
            item.user = { id: context.userId! };

            return item;
          });
        } else {
          input.user = { id: context.userId! };
        }
      }

      if (Array.isArray(input)) {
        input = input.map((item) => {
          item.event = { id: item.event_id! };

          return item;
        });
      } else {
        input.event = { id: input.event_id! };
      }

      return await this.contentService.create(serviceContext, input);
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
    const serviceContext = toServiceContext(context);

    return this.contentService.findAll(serviceContext);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findById(@Param('id') id: string, @Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    return this.contentService.findById(serviceContext, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe(updateContentSchema)) input: UpdateContentDto,
    @Context() context: RequestContext,
  ) {
    const serviceContext = toServiceContext(context);

    const result = await this.contentService.update(serviceContext, id, input);

    if (!result) {
      throw new NotFoundException();
    }

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Context() context: RequestContext, @Param('id') id: string): Promise<void> {
    const serviceContext = toServiceContext(context);

    const content = await this.contentService.findById(serviceContext, id);

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    const removal = this.contentService.remove(serviceContext, id);

    if (!removal) {
      throw new NotFoundException('Content not found');
    }
  }
}
