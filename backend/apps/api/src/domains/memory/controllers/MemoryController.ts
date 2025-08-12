import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { IdFormatGuard, JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';

import { MemoryService } from '../services/MemoryService';
import { MemorySearchParams } from '../types';

const memorySearchSchema = z.object({
  query: z.string().optional(),
  startDate: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
  endDate: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
  categories: z.array(z.string()).optional(),
  hasLocation: z.boolean().optional(),
  limit: z.number().int().positive().max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

@Controller('memory')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get()
  async findAll(
    @Context() context: RequestContext,
    @Query(new ValidationPipe(memorySearchSchema)) params: MemorySearchParams,
  ) {
    return this.memoryService.findAll(context, params);
  }

  @Get(':id')
  @UseGuards(IdFormatGuard)
  async findOne(
    @Context() context: RequestContext,
    @Param('id') id: string,
  ) {
    return this.memoryService.findOne(context, id);
  }
}
