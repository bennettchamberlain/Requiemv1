import { Module } from '@nestjs/common';

import { ToolsModule } from '@ci/domains/tools';

import { LlmEndpointService } from './services/LlmEndpointService';
import { OllamaService } from './services/OllamaService';

/** Ollama client wiring without listeners that depend on personalization. */
@Module({
  imports: [ToolsModule],
  providers: [LlmEndpointService, OllamaService],
  exports: [OllamaService, LlmEndpointService],
})
export class LlmCoreModule {}
