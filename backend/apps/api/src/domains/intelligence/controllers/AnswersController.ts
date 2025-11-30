import { Body, Controller, Get, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import type { RequestContext } from '@ci/common/types';

import { AnswerService } from '../services/AnswerService';
import type { UpdateAnswerDto } from '../types';

const updateAnswerSchema = z.object({
  answer_text: z.string().min(1, 'Answer text is required').optional(),
});

@Controller('answers')
export class AnswersController {
  constructor(private readonly questionService: AnswerService) {}

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
