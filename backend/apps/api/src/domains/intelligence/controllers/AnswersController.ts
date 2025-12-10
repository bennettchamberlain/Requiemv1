import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
  Delete,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import type { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';

import { AnswerService } from '../services/AnswerService';
import { type CreateAnswerDto, type UpdateAnswerDto, createAnswerSchema, updateAnswerSchema } from '../types';

@Controller('answers')
export class AnswersController {
  constructor(private readonly answerService: AnswerService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createAnswerSchema)) data: CreateAnswerDto,
  ) {
    const serviceContext = toServiceContext(context);

    return this.answerService.create(serviceContext, data);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    return this.answerService.findAll(serviceContext);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Context() context: RequestContext, @Param('id') id: string) {
    const serviceContext = toServiceContext(context);

    return this.answerService.findById(serviceContext, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') id: string,
    @Body(new ValidationPipe(updateAnswerSchema)) data: UpdateAnswerDto,
  ) {
    const serviceContext = toServiceContext(context);

    const result = await this.answerService.update(serviceContext, id, data);

    if (!result) {
      throw new NotFoundException();
    }

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Context() context: RequestContext, @Param('id') answerId: string): Promise<void> {
    const serviceContext = toServiceContext(context);

    const answer = await this.answerService.findById(serviceContext, answerId);

    if (!answer) {
      throw new NotFoundException('Answer not found');
    }

    const removal = await this.answerService.remove(serviceContext, answerId);

    if (!removal) {
      throw new NotFoundException();
    }
  }
}
