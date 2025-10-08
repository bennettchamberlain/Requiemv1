import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { IdFormatGuard, JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';

import { MemoryService } from '../services/MemoryService';
import { MemorySearchParams } from '../types';

const memorySearchSchema = z.object({
  query: z.string().optional(),
  startDate: z
    .string()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  endDate: z
    .string()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  categories: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === 'string') {
        return [val];
      }

      return val;
    }),
  hasLocation: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === 'string') {
        return val === 'true';
      }

      return val;
    }),
  limit: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => {
      const num = typeof val === 'string' ? parseInt(val, 10) : val;

      return Math.min(Math.max(1, num || 50), 100);
    }),
  offset: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => {
      const num = typeof val === 'string' ? parseInt(val, 10) : val;

      return Math.max(0, num || 0);
    }),
});

@Controller('memory')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  private logger = new LoggerService(MemoryController.name);

  constructor(private readonly memoryService: MemoryService) {}

  @Get()
  async findAll(
    @Context() context: RequestContext,
    @Query(new ValidationPipe(memorySearchSchema)) params: MemorySearchParams,
  ) {
    this.logger.debug('Memory findAll request', {
      userId: context.userId,
      params,
      hasUserId: !!context.userId,
    });

    if (!context.userId) {
      this.logger.warn('No userId in context', { context });
    }

    try {
      const result = await this.memoryService.findAll(context, params);
      this.logger.debug('Memory findAll response', {
        dataLength: result.data.length,
        total: result.total,
      });

      return result;
    } catch (error) {
      this.logger.error('Error in memory findAll', { error, userId: context.userId });
      throw error;
    }
  }

  @Get(':id')
  @UseGuards(IdFormatGuard)
  async findOne(@Context() context: RequestContext, @Param('id') id: string) {
    return this.memoryService.findOne(context, id);
  }

  @Get('debug/info')
  async debugInfo(@Context() context: RequestContext) {
    this.logger.debug('Debug info endpoint called', { userId: context.userId });

    try {
      const result = await this.memoryService.getDebugInfo(context);

      return {
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Debug info error', { error, userId: context.userId });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
