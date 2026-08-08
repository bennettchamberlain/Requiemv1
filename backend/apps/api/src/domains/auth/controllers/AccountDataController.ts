import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { BodyLimit } from '@ci/common/decorators';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { UserDataPortabilityService, type UserDataArchive } from '@ci/domains/portability';
import { UserService } from '@ci/domains/user';

const importArchiveSchema = z.object({
  confirmEmail: z.string().min(1),
  archive: z.object({
    version: z.literal(1),
    exportedAt: z.string(),
    userId: z.string().uuid(),
    profile: z.record(z.string(), z.unknown()).nullable(),
    tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    fileBlobs: z.array(
      z.object({
        id: z.string(),
        bucket: z.string(),
        key: z.string(),
        contentBase64: z.string(),
      }),
    ),
  }),
});

/**
 * Export / import the authenticated user's Memory data as a portable archive.
 *
 * Uses the same guard as account deletion so native clients (API key, no JWT)
 * can back up and restore on a self-hosted appliance.
 */
@Controller('account')
@UseGuards(JwtOrApiKeyAuthGuard)
export class AccountDataController {
  constructor(
    private readonly portabilityService: UserDataPortabilityService,
    private readonly userService: UserService,
  ) {}

  @Get('export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  async export(@Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);
    const archive = await this.portabilityService.exportArchive(serviceContext);
    const filename = `ci-memory-export-${archive.exportedAt.slice(0, 10)}.json`;

    return {
      filename,
      archive,
    };
  }

  @Post('import')
  @BodyLimit('500mb')
  @HttpCode(HttpStatus.OK)
  async import(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(importArchiveSchema))
    body: z.infer<typeof importArchiveSchema>,
  ) {
    const serviceContext = toServiceContext(context);
    const user = await this.userService.findById(serviceContext, serviceContext.userId);

    if (!user) {
      throw new BadRequestException('Account not found');
    }

    if (body.confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new BadRequestException('Confirmation email does not match this account');
    }

    return this.portabilityService.importArchive(serviceContext, body.archive as UserDataArchive);
  }
}
