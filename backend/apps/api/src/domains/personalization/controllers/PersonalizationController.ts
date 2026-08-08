import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';

import { PersonalizationService } from '../services/PersonalizationService';
import { PromotionCandidateService } from '../services/PromotionCandidateService';
import type { TrustMode } from '../types';

@UseGuards(JwtOrApiKeyAuthGuard)
@Controller('personalization')
export class PersonalizationController {
  constructor(
    private readonly personalizationService: PersonalizationService,
    private readonly promotionCandidateService: PromotionCandidateService,
  ) {}

  @Get('profile')
  async getProfile(@Context() context: RequestContext) {
    const profile = await this.personalizationService.getProfile(context.userId!);

    return profile;
  }

  @Post('trust-mode')
  async updateTrustMode(@Context() context: RequestContext, @Body() body: { trustMode: TrustMode }) {
    const profile = await this.personalizationService.updateTrustMode(toServiceContext(context), body.trustMode);

    return profile;
  }

  @Get('promotion-candidates')
  async listPromotionCandidates(@Context() context: RequestContext) {
    return this.promotionCandidateService.listPending(toServiceContext(context));
  }

  @Post('promotion-candidates/:id/accept')
  async acceptPromotionCandidate(@Context() context: RequestContext, @Param('id') id: string) {
    return this.promotionCandidateService.accept(toServiceContext(context), id);
  }

  @Post('promotion-candidates/:id/reject')
  async rejectPromotionCandidate(@Context() context: RequestContext, @Param('id') id: string) {
    return this.promotionCandidateService.reject(toServiceContext(context), id);
  }
}
