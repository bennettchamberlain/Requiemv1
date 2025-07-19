import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';

import { ValidationPipe } from '@ci/common/pipes';

import { ProviderService } from '../services/ProviderService';
import type { CreateProviderDto, UpdateProviderDto } from '../types';

const createProviderSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

const updateProviderSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
});

@Controller('providers')
export class ProvidersController {
  constructor(private readonly providerService: ProviderService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  async findAll() {
    return this.providerService.findAll();
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.providerService.findOne(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post()
  async create(@Body(new ValidationPipe(createProviderSchema)) input: CreateProviderDto) {
    return this.providerService.create(input);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe(updateProviderSchema)) input: UpdateProviderDto,
  ) {
    return this.providerService.update(id, input);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string) {
    await this.providerService.delete(id);
  }
}
