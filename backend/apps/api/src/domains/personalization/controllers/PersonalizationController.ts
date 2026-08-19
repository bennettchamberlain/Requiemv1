import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { ImageDescriptionPreferenceService } from '@ci/domains/llm/image-description-preference.module';

import { PersonalizationService } from '../services/PersonalizationService';
import type { TrustMode } from '../types';

@UseGuards(JwtOrApiKeyAuthGuard)
@Controller('personalization')
export class PersonalizationController {
  constructor(
    private readonly personalizationService: PersonalizationService,
    private readonly imageDescriptionPreference: ImageDescriptionPreferenceService,
  ) {}

  @Get('profile')
  async getProfile(@Context() context: RequestContext) {
    const profile = await this.personalizationService.getProfile(context.userId!);

    return profile;
  }

  @Post('trust-mode')
  async updateTrustMode(@Context() context: RequestContext, @Body() body: { trustMode: TrustMode }) {
    const profile = await this.personalizationService.updateTrustMode(
      toServiceContext(context),
      body.trustMode,
    );

    return profile;
  }

  /**
   * Settings → Model "Describe images". Kept off GET /profile so the trust
   * payload stays a trust payload; this flag is an inference preference.
   */
  @Get('image-description')
  async getImageDescription(@Context() context: RequestContext) {
    const enabled = await this.imageDescriptionPreference.isEnabled(context.userId!);

    return { enabled };
  }

  @Post('image-description')
  async updateImageDescription(@Context() context: RequestContext, @Body() body: { enabled: boolean }) {
    const enabled = await this.imageDescriptionPreference.setEnabled(
      toServiceContext(context),
      body.enabled === true,
    );

    return { enabled };
  }
}
