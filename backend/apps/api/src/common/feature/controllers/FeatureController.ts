import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '@ci/common/guards';

import { FeatureService } from '../services/FeatureService';

@Controller('_internal')
export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  @UseGuards(JwtAuthGuard)
  @Get('features')
  @HttpCode(200)
  async features() {
    const allFeatures = await this.featureService.getAllFeatures();

    return allFeatures;
  }
}
