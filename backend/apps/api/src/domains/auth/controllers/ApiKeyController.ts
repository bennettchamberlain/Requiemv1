import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';

import { ApiKeyService } from '../services/ApiKeyService';
import type { CreateApiKeyDto, UpdateApiKeyDto } from '../types';

/**
 * `app:` is reserved for connection keys minted by the consent flow
 * (`app:<appName>:<store>`). CI-Hub owns their lifecycle and revokes them by that
 * exact name, and `isHubManagedKey` classifies them by this prefix — so a
 * user-created key sharing it would be rotated, re-scoped, or deleted out from
 * under its owner by machinery meant for a different key. Reject it at the door
 * rather than let the two namespaces collide.
 */
const RESERVED_NAME_PREFIX = 'app:';

const apiKeyName = z
  .string()
  .min(1)
  .max(255)
  .refine((name) => !name.startsWith(RESERVED_NAME_PREFIX), {
    message: `Key names starting with "${RESERVED_NAME_PREFIX}" are reserved for connected apps`,
  });

const createApiKeySchema = z.object({
  name: apiKeyName,
  scopes: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional(),
});

const updateApiKeySchema = z.object({
  name: apiKeyName.optional(),
  scopes: z.array(z.string()).optional(),
});

@Controller('keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createApiKeySchema)) input: CreateApiKeyDto,
  ) {
    const serviceContext = toServiceContext(context);

    return this.apiKeyService.create(serviceContext, input);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    return this.apiKeyService.findAllByUser(serviceContext);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Context() context: RequestContext, @Param('id') keyId: string) {
    const serviceContext = toServiceContext(context);

    const key = await this.apiKeyService.findOneByUser(serviceContext, keyId);

    if (!key) {
      throw new NotFoundException('API key not found');
    }

    return key;
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') keyId: string,
    @Body(new ValidationPipe(updateApiKeySchema)) input: UpdateApiKeyDto,
  ) {
    const serviceContext = toServiceContext(context);

    const key = await this.apiKeyService.update(serviceContext, keyId, input);

    if (!key) {
      throw new NotFoundException('API key not found');
    }

    return key;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Context() context: RequestContext, @Param('id') keyId: string): Promise<void> {
    const serviceContext = toServiceContext(context);

    const removed = await this.apiKeyService.remove(serviceContext, keyId);

    if (!removed) {
      throw new NotFoundException('API key not found');
    }
  }
}
