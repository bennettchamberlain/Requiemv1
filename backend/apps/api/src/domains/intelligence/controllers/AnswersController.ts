import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import type { RequestContext } from '@ci/common/types';

import { AnswerService } from '../services/AnswerService';
import type { CreateAnswerDto, UpdateAnswerDto } from '../types';

const createAnswerSchema = z.object({
  text: z.string().min(1, 'Answer text is required').max(5000, 'Answer text must be 5000 characters or less'),
  question: z.object({
    id: z.string().uuid('Invalid question ID'),
  }),
});

const updateAnswerSchema = z.object({
  answer_text: z
    .string()
    .min(1, 'Answer text is required')
    .max(5000, 'Answer text must be 5000 characters or less')
    .optional(),
});

@Controller('answers')
export class AnswersController {
  constructor(private readonly questionService: AnswerService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createAnswerSchema)) data: CreateAnswerDto,
  ) {
    return this.questionService.create(context, data);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Context() context: RequestContext) {
    return this.questionService.findAll(context);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Context() context: RequestContext, @Param('id') id: string) {
    return this.questionService.findOne(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') id: string,
    @Body(new ValidationPipe(updateAnswerSchema)) data: UpdateAnswerDto,
  ) {
    const result = await this.questionService.update(context, id, data);

    if (!result) {
      throw new NotFoundException();
    }

    return result;
  }
}
