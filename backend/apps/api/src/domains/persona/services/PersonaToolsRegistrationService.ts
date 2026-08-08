import { Injectable, OnModuleInit } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { ToolRegistry, type ToolProvider, type ProviderHealthStatus } from '@ci/domains/tools';

import { PersonaComposeTool } from '../tools/PersonaComposeTool';

/**
 * Registers persona intents with the global ToolRegistry after ToolsModule boot.
 * Kept in PersonaModule to avoid a ToolsModule ↔ PersonaModule circular import.
 */
@Injectable()
export class PersonaToolsRegistrationService implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly personaComposeTool: PersonaComposeTool,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PersonaToolsRegistrationService.name);
  }

  async onModuleInit() {
    const provider: ToolProvider = {
      name: 'persona',
      initialize: async () => {},
      shutdown: async () => {},
      getAvailableTools: async () => [this.personaComposeTool.schema],
      getTool: (name: string) =>
        name === this.personaComposeTool.schema.name ? this.personaComposeTool : undefined,
      canHandle: (name: string) => name === this.personaComposeTool.schema.name,
      getHealthStatus: async (): Promise<ProviderHealthStatus> => ({
        name: 'persona',
        status: 'healthy',
        toolCount: 1,
        lastCheck: new Date(),
      }),
    };

    await this.toolRegistry.registerProvider(provider);
    this.logger.debug('Registered persona tool provider');
  }
}
