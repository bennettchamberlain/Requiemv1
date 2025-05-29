import { Module } from '@nestjs/common';
import { RequestContextService } from './RequestContextService';

@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class ContextModule {}

export { RequestContextService };
export type { RequestContext } from './types';
