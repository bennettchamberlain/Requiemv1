import {
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

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';

import { CommunicationService } from '../services/CommunicationService';
import {
  CreateCommunicationDto,
  UpdateCommunicationDto,
  createCommunicationSchema,
  updateCommunicationSchema,
} from '../types';

@Controller('communications')
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Req() req: Request,
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createCommunicationSchema)) input: CreateCommunicationDto,
  ) {
    const serviceContext = toServiceContext(context);

    return await this.communicationService.create(serviceContext, input);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    return this.communicationService.findAll(serviceContext);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findById(@Param('id') id: string, @Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    return this.communicationService.findById(serviceContext, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe(updateCommunicationSchema)) input: UpdateCommunicationDto,
    @Context() context: RequestContext,
  ) {
    const serviceContext = toServiceContext(context);

    const result = await this.communicationService.update(serviceContext, id, input);

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

    const communication = await this.communicationService.findById(serviceContext, id);

    if (!communication) {
      throw new NotFoundException('Communication not found');
    }

    const removal = this.communicationService.remove(serviceContext, id);

    if (!removal) {
      throw new NotFoundException('Communication not found');
    }
  }
}
