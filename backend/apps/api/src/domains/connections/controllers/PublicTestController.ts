import {
  Controller,
  Get,
  Logger,
} from '@nestjs/common';

@Controller('public-test')
export class PublicTestController {
  private readonly logger = new Logger(PublicTestController.name);

  constructor() {
    this.logger.log('********** PublicTestController initialized **********');
  }

  @Get('ping')
  async ping() {
    this.logger.log('********** Public test ping endpoint hit **********');
    return { 
      message: 'Public test endpoint working', 
      timestamp: new Date().toISOString(),
      auth: 'none'
    };
  }
}
